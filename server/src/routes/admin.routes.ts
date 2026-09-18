import archiver from 'archiver';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config, LANGUAGE_CODES } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../types.js';
import type { Hop, ModelJob } from '../types.js';
import { requireAdmin, wrap } from '../middleware.js';
import { getBlob, storeBlob } from '../services/blobs.service.js';
import { createSeed, getChain, listChainSummaries, listHops } from '../services/chains.service.js';
import { retryJob } from '../services/model-worker.js';
import { wavDurationMs } from '../providers/wav.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

adminRouter.get(
  '/overview',
  wrap(async (_req, res) => {
    const chains = await listChainSummaries();
    const [participants] = await db('participants').count<{ count: string }[]>('id as count');
    const [humanHops] = await db('hops').where('contributor_type', 'HUMAN').count<{ count: string }[]>('id as count');
    const [modelHops] = await db('hops').where('contributor_type', 'MODEL').count<{ count: string }[]>('id as count');
    const jobs = await db('model_jobs')
      .select<ModelJob[]>('id', 'chain_id', 'parent_hop_id', 'kind', 'status', 'attempts', 'last_error', 'created_at', 'updated_at')
      .whereIn('status', ['PENDING', 'RUNNING', 'FAILED'])
      .orderBy('created_at', 'desc')
      .limit(100);
    res.json({
      totals: {
        participants: Number(participants.count),
        chains: chains.length,
        human_hops: Number(humanHops.count),
        model_hops: Number(modelHops.count),
      },
      config: {
        max_hops: config.maxHops,
        model_every_n: config.modelEveryN,
        composition: config.composition,
        audio_model_kind: config.audioModelKind,
        providers: { gemini: Boolean(config.gemini.apiKey), groq: Boolean(config.groq.apiKey) },
      },
      chains,
      jobs,
    });
  }),
);

adminRouter.get(
  '/chains/:id',
  wrap(async (req, res) => {
    const chain = await getChain(Number(req.params.id));
    const hops = await listHops(chain.id);
    res.json({ chain, hops: hops.map(hopView) });
  }),
);

function hopView(h: Hop) {
  return { ...h, audio_url: h.audio_blob_id ? `/api/admin/hops/${h.id}/audio` : null };
}

adminRouter.get(
  '/hops/:id/audio',
  wrap(async (req, res) => {
    const hop = await db('hops').select('audio_blob_id').where({ id: Number(req.params.id) }).first<{ audio_blob_id: number | null }>();
    if (!hop?.audio_blob_id) throw new HttpError(404, 'No audio', 'NO_AUDIO');
    const blob = await getBlob(hop.audio_blob_id);
    if (!blob) throw new HttpError(404, 'No audio', 'NO_AUDIO');
    res.setHeader('content-type', blob.mime);
    res.send(blob.bytes);
  }),
);

adminRouter.post(
  '/seeds',
  upload.single('audio'),
  wrap(async (req, res) => {
    const body = z
      .object({
        modality: z.enum(['AUDIO', 'TEXT']),
        language: z.enum(LANGUAGE_CODES as [string, ...string[]]),
        composition: z.enum(['ALL_HUMAN', 'ALL_MODEL', 'MIXED']).optional(),
        text: z.string().max(20000).optional(),
        title: z.string().max(200).optional(),
      })
      .parse(req.body);
    let audioBlobId: number | undefined;
    let audioMime: string | undefined;
    let audioDurationMs: number | undefined;
    if (body.modality === 'AUDIO') {
      if (!req.file) throw new HttpError(400, 'audio file required', 'VALIDATION');
      audioMime = req.file.mimetype;
      audioDurationMs = wavDurationMs(req.file.buffer) ?? undefined;
      audioBlobId = await storeBlob(req.file.buffer, audioMime);
    }
    const { chain, seed } = await createSeed({
      modality: body.modality,
      language: body.language,
      composition: body.composition,
      text: body.text,
      audioBlobId,
      audioMime,
      audioDurationMs,
      metadata: body.title ? { title: body.title } : {},
    });
    res.status(201).json({ chain, seed: hopView(seed) });
  }),
);

adminRouter.post(
  '/jobs/:id/retry',
  wrap(async (req, res) => {
    await retryJob(Number(req.params.id));
    res.json({ ok: true });
  }),
);

interface ExportRow {
  chain: { id: number; code: string; modality: string; language: string; composition: string; max_hops: number; status: string };
  hops: Array<Record<string, unknown>>;
}

async function buildExport(includePii: boolean): Promise<{ generated_at: string; participants: unknown[]; chains: ExportRow[] }> {
  const participants = await db('participants')
    .select('id', 'name', 'email', 'gender', 'study_level', 'consent_audio', 'consent_text', 'preferred_language', 'created_at')
    .orderBy('id');
  const chains = await db('chains').select('id', 'code', 'modality', 'language', 'composition', 'max_hops', 'status').orderBy('code');
  const hops = await db('hops')
    .select(
      'id', 'chain_id', 'hop_index', 'parent_hop_id', 'contributor_type', 'participant_id', 'model_name', 'text_content',
      'audio_blob_id', 'audio_mime', 'audio_duration_ms', 'listen_count', 'takes_count', 'read_seconds', 'metadata', 'created_at',
    )
    .orderBy(['chain_id', 'hop_index']);
  const byChain = new Map<number, Array<Record<string, unknown>>>();
  for (const h of hops as Array<Record<string, unknown> & { chain_id: number; id: number; audio_blob_id: number | null; chain_code?: string }>) {
    const chain = chains.find((c) => c.id === h.chain_id);
    const audioFile = h.audio_blob_id ? `audio/${chain?.code}/hop-${String(h.hop_index).padStart(2, '0')}-${h.id}.wav` : null;
    const list = byChain.get(h.chain_id) ?? [];
    list.push({ ...h, audio_file: audioFile });
    byChain.set(h.chain_id, list);
  }
  return {
    generated_at: new Date().toISOString(),
    participants: participants.map((p) => (includePii ? p : { ...p, name: undefined, email: undefined })),
    chains: chains.map((c) => ({ chain: c, hops: byChain.get(c.id) ?? [] })),
  };
}

adminRouter.get(
  '/export.json',
  wrap(async (req, res) => {
    res.json(await buildExport(req.query.pii === '1'));
  }),
);

adminRouter.get(
  '/export.zip',
  wrap(async (req, res) => {
    const data = await buildExport(req.query.pii === '1');
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="whisper-chain-export-${Date.now()}.zip"`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error(err);
      res.end();
    });
    archive.pipe(res);
    archive.append(JSON.stringify(data, null, 2), { name: 'data.json' });
    for (const row of data.chains) {
      for (const hop of row.hops) {
        const blobId = hop.audio_blob_id as number | null;
        const file = hop.audio_file as string | null;
        if (!blobId || !file) continue;
        const blob = await getBlob(blobId);
        if (blob) archive.append(blob.bytes, { name: file });
      }
    }
    await archive.finalize();
  }),
);
