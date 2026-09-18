/**
 * Runs against a real PostgreSQL (DATABASE_URL) with the model providers
 * mocked. Skipped when DATABASE_URL is not set.
 *   DATABASE_URL=postgres://... pnpm vitest run src/services/model-worker.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../providers/gemini.js', async () => {
  const { pcmToWav } = await import('../providers/wav.js');
  return {
    geminiRecallText: vi.fn(async (text: string) => ({ text: `recalled(${text})`, model: 'mock-gemini' })),
    geminiRecallAudio: vi.fn(async () => ({ text: 'heard something', model: 'mock-gemini' })),
    geminiTts: vi.fn(async () => ({ wav: pcmToWav(Buffer.alloc(24000 * 2), 24000), model: 'mock-tts' })),
  };
});
vi.mock('../providers/groq.js', () => ({
  groqTranscribe: vi.fn(async () => ({ text: 'transcript', model: 'mock-whisper' })),
  groqRecallText: vi.fn(async (text: string) => ({ text: `llama(${text})`, model: 'mock-llama' })),
}));

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)('model worker', () => {
  let db: typeof import('../db.js').db;
  let worker: typeof import('./model-worker.js');
  let chains: typeof import('./chains.service.js');
  let blobs: typeof import('./blobs.service.js');
  let config: typeof import('../config.js').config;

  beforeAll(async () => {
    process.env.GEMINI_API_KEY = 'test';
    process.env.GROQ_API_KEY = 'test';
    process.env.MAX_HOPS = '3';
    ({ db } = await import('../db.js'));
    ({ config } = await import('../config.js'));
    await db.migrate.latest();
    worker = await import('./model-worker.js');
    chains = await import('./chains.service.js');
    blobs = await import('./blobs.service.js');
  });
  afterAll(async () => {
    await db.destroy();
  });

  /** Tick until no PENDING job remains (bounded). */
  async function drain(): Promise<void> {
    for (let i = 0; i < 30; i++) {
      await worker.tick();
      const [row] = await db('model_jobs').where('status', 'PENDING').count<{ count: string }[]>('id as count');
      if (Number(row.count) === 0) return;
    }
  }

  it('LLM_TEXT job appends a MODEL hop and completes an ALL_MODEL chain via repeated ticks', async () => {
    const { chain } = await chains.createSeed({ modality: 'TEXT', language: 'hi', composition: 'ALL_MODEL', text: 'नमस्ते दुनिया' });
    await drain();
    const hops = await chains.listHops(chain.id);
    expect(hops.map((h) => h.contributor_type)).toEqual(['SEED', 'MODEL', 'MODEL', 'MODEL']);
    expect(hops[1].text_content).toBe('recalled(नमस्ते दुनिया)');
    expect(hops[1].model_name).toBe('mock-gemini');
    const updated = await chains.getChain(chain.id);
    expect(updated.status).toBe('COMPLETE');
    const open = await db('model_jobs').where({ chain_id: chain.id }).whereIn('status', ['PENDING', 'RUNNING']);
    expect(open).toHaveLength(0);
  });

  it('audio jobs produce a WAV hop with transcript metadata', async () => {
    const blobId = await blobs.storeBlob(Buffer.alloc(44 + 16000 * 2), 'audio/wav');
    const { chain } = await chains.createSeed({ modality: 'AUDIO', language: 'bn', composition: 'ALL_MODEL', audioBlobId: blobId, audioMime: 'audio/wav' });
    await drain();
    const hops = await chains.listHops(chain.id);
    expect(hops).toHaveLength(4);
    expect(hops[1].audio_blob_id).not.toBeNull();
    expect(hops[1].audio_mime).toBe('audio/wav');
    expect(hops[1].audio_duration_ms).toBe(1000);
    expect(['ALM_AUDIO', 'WHISPER_AUDIO']).toContain((hops[1].metadata as { job_kind: string }).job_kind);
    expect(hops[1].text_content).toMatch(/heard something|llama\(transcript\)/);
  });

  it('MIXED chain: model hop lands at hop 3 and the head returns to the human pool', async () => {
    process.env.MAX_HOPS = '6';
    config.maxHops = 6;
    const { chain, seed } = await chains.createSeed({ modality: 'TEXT', language: 'en', composition: 'MIXED', text: 'seed' });
    const [p] = await db('participants').insert({ resume_code: `T${Date.now().toString(36).toUpperCase().slice(-7)}`, name: 'a' }).returning<{ id: number }[]>('id');
    const h1 = await chains.appendHop({ chainId: chain.id, parentHopId: seed.id, contributorType: 'HUMAN', participantId: p.id, text: 'h1' });
    const h2 = await chains.appendHop({ chainId: chain.id, parentHopId: h1.id, contributorType: 'HUMAN', participantId: p.id, text: 'h2' });
    const pending = await db('model_jobs').where({ chain_id: chain.id, status: 'PENDING' });
    expect(pending).toHaveLength(1);
    expect(pending[0].parent_hop_id).toBe(h2.id);
    await drain();
    const hops = await chains.listHops(chain.id);
    expect(hops.map((h) => `${h.hop_index}:${h.contributor_type}`)).toEqual(['0:SEED', '1:HUMAN', '2:HUMAN', '3:MODEL']);
    const jobs = await db('model_jobs').where({ chain_id: chain.id }).whereIn('status', ['PENDING', 'RUNNING']);
    expect(jobs).toHaveLength(0); // hop 4 is human again
  });

  it('a failing provider retries up to 3 times then marks the job FAILED', async () => {
    const gemini = await import('../providers/gemini.js');
    (gemini.geminiRecallText as unknown as { mockRejectedValue: (e: Error) => void }).mockRejectedValue(new Error('quota'));
    const { chain } = await chains.createSeed({ modality: 'TEXT', language: 'ta', composition: 'ALL_MODEL', text: 'x' });
    for (let i = 0; i < 6; i++) await worker.tick();
    const job = await db('model_jobs').where({ chain_id: chain.id }).first();
    expect(job.status).toBe('FAILED');
    expect(job.attempts).toBe(3);
    expect(job.last_error).toBe('quota');
    await worker.retryJob(job.id);
    const retried = await db('model_jobs').where({ id: job.id }).first();
    expect(retried.status).toBe('PENDING');
    expect(retried.attempts).toBe(0);
  });
});
