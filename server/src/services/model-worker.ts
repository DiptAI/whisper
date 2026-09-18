/**
 * Background worker that executes MODEL hops. Polls model_jobs, runs the
 * provider pipeline, appends the hop and lets afterHopCreated queue the next.
 */
import { config } from '../config.js';
import { db } from '../db.js';
import type { ModelJob } from '../types.js';
import { getBlob, storeBlob } from './blobs.service.js';
import { appendHop, getChain, getHop } from './chains.service.js';
import { geminiRecallAudio, geminiRecallText, geminiTts } from '../providers/gemini.js';
import { groqRecallText, groqTranscribe } from '../providers/groq.js';
import { wavDurationMs } from '../providers/wav.js';

const MAX_ATTEMPTS = 3;
const JOB_COLUMNS = ['id', 'chain_id', 'parent_hop_id', 'kind', 'status', 'attempts', 'last_error', 'created_at', 'updated_at'] as const;

let timer: NodeJS.Timeout | null = null;
let running = false;

export function providersConfigured(): boolean {
  return Boolean(config.gemini.apiKey || config.groq.apiKey);
}

export function startModelWorker(): void {
  if (!providersConfigured()) {
    console.warn('[worker] no GEMINI_API_KEY / GROQ_API_KEY set: model hops will stay PENDING');
  }
  timer = setInterval(() => void tick(), config.modelWorkerIntervalMs);
  void tick();
}

export function stopModelWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function tick(): Promise<void> {
  if (running || !providersConfigured()) return;
  running = true;
  try {
    // Drain a few jobs per tick; keep free-tier rate limits in mind.
    for (let i = 0; i < 3; i++) {
      const job = await claimJob();
      if (!job) break;
      await runJob(job);
    }
  } catch (err) {
    console.error('[worker] tick failed', err);
  } finally {
    running = false;
  }
}

async function claimJob(): Promise<ModelJob | null> {
  return db.transaction(async (trx) => {
    const job = await trx('model_jobs')
      .select(JOB_COLUMNS)
      .where('status', 'PENDING')
      .orderBy('created_at', 'asc')
      .forUpdate()
      .skipLocked()
      .first<ModelJob>();
    if (!job) return null;
    await trx('model_jobs').where({ id: job.id }).update({ status: 'RUNNING', attempts: job.attempts + 1, updated_at: trx.fn.now() });
    return { ...job, status: 'RUNNING', attempts: job.attempts + 1 };
  });
}

export async function runJob(job: ModelJob): Promise<void> {
  try {
    const chain = await getChain(job.chain_id);
    const parent = await getHop(job.parent_hop_id);
    if (job.kind === 'LLM_TEXT') {
      const source = parent.text_content ?? '';
      const out = config.gemini.apiKey ? await geminiRecallText(source, chain.language) : await groqRecallText(source, chain.language);
      await db.transaction(async (trx) => {
        // Close this job before appending: afterHopCreated may queue the next
        // job and only one open job per chain is allowed.
        await trx('model_jobs').where({ id: job.id }).update({ status: 'DONE', updated_at: trx.fn.now() });
        await appendHop(
          { chainId: chain.id, parentHopId: parent.id, contributorType: 'MODEL', modelName: out.model, text: out.text, metadata: { job_kind: job.kind } },
          trx,
        );
      });
    } else {
      if (!parent.audio_blob_id) throw new Error('parent hop has no audio');
      const src = await getBlob(parent.audio_blob_id);
      if (!src) throw new Error('parent audio blob missing');
      let recalled: { text: string; model: string };
      let transcript: string | null = null;
      let transcriptModel: string | null = null;
      if (job.kind === 'ALM_AUDIO') {
        recalled = await geminiRecallAudio(src.bytes, src.mime, chain.language);
      } else {
        const t = await groqTranscribe(src.bytes, src.mime, chain.language);
        transcript = t.text;
        transcriptModel = t.model;
        recalled = config.groq.apiKey ? await groqRecallText(t.text, chain.language) : await geminiRecallText(t.text, chain.language);
      }
      const tts = await geminiTts(recalled.text);
      const blobId = await storeBlob(tts.wav, 'audio/wav');
      const modelName = transcriptModel ? `${transcriptModel} > ${recalled.model} > ${tts.model}` : `${recalled.model} > ${tts.model}`;
      await db.transaction(async (trx) => {
        await trx('model_jobs').where({ id: job.id }).update({ status: 'DONE', updated_at: trx.fn.now() });
        await appendHop(
          {
            chainId: chain.id,
            parentHopId: parent.id,
            contributorType: 'MODEL',
            modelName,
            text: recalled.text,
            audioBlobId: blobId,
            audioMime: 'audio/wav',
            audioDurationMs: wavDurationMs(tts.wav),
            metadata: { job_kind: job.kind, transcript, transcript_model: transcriptModel },
          },
          trx,
        );
      });
    }
    console.log(`[worker] job ${job.id} (${job.kind}) done for chain ${job.chain_id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = job.attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING';
    console.error(`[worker] job ${job.id} attempt ${job.attempts} failed: ${message}`);
    await db('model_jobs').where({ id: job.id }).update({ status, last_error: message, updated_at: db.fn.now() });
  }
}

export async function retryJob(id: number): Promise<void> {
  await db('model_jobs').where({ id }).update({ status: 'PENDING', attempts: 0, last_error: null, updated_at: db.fn.now() });
}
