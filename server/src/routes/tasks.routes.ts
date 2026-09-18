import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config, LANGUAGE_CODES } from '../config.js';
import { HttpError } from '../types.js';
import { requireParticipant, wrap } from '../middleware.js';
import {
  abandon, fetchSourceAudio, fetchSourceText, getAssignmentForParticipant, hideText, startTask, submitAudio, submitText, toView,
} from '../services/assignment.service.js';
import { storeBlob } from '../services/blobs.service.js';
import { wavDurationMs } from '../providers/wav.js';

export const tasksRouter = Router();
tasksRouter.use(requireParticipant);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes } });

tasksRouter.post(
  '/start',
  wrap(async (req, res) => {
    const body = z.object({ modality: z.enum(['AUDIO', 'TEXT']), language: z.enum(LANGUAGE_CODES as [string, ...string[]]) }).parse(req.body);
    const p = req.participant!;
    if (body.modality === 'AUDIO' && !p.consent_audio) throw new HttpError(403, 'You did not consent to audio collection', 'NO_CONSENT');
    if (body.modality === 'TEXT' && !p.consent_text) throw new HttpError(403, 'You did not consent to text collection', 'NO_CONSENT');
    res.json({ task: await startTask(p.id, body.modality, body.language) });
  }),
);

tasksRouter.get(
  '/:id',
  wrap(async (req, res) => {
    const a = await getAssignmentForParticipant(Number(req.params.id), req.participant!.id);
    res.json({ task: await toView(a) });
  }),
);

tasksRouter.get(
  '/:id/audio',
  wrap(async (req, res) => {
    const a = await getAssignmentForParticipant(Number(req.params.id), req.participant!.id);
    const blob = await fetchSourceAudio(a);
    res.setHeader('content-type', blob.mime);
    res.setHeader('cache-control', 'no-store');
    res.send(blob.bytes);
  }),
);

tasksRouter.get(
  '/:id/text',
  wrap(async (req, res) => {
    const a = await getAssignmentForParticipant(Number(req.params.id), req.participant!.id);
    res.json(await fetchSourceText(a));
  }),
);

tasksRouter.post(
  '/:id/hide',
  wrap(async (req, res) => {
    const a = await getAssignmentForParticipant(Number(req.params.id), req.participant!.id);
    await hideText(a);
    res.json({ ok: true });
  }),
);

tasksRouter.post(
  '/:id/submit-text',
  wrap(async (req, res) => {
    const body = z.object({ text: z.string().min(1).max(20000) }).parse(req.body);
    const a = await getAssignmentForParticipant(Number(req.params.id), req.participant!.id);
    const hop = await submitText(a, body);
    res.json({ ok: true, hop_index: hop.hop_index });
  }),
);

tasksRouter.post(
  '/:id/submit-audio',
  upload.single('audio'),
  wrap(async (req, res) => {
    const a = await getAssignmentForParticipant(Number(req.params.id), req.participant!.id);
    if (!req.file) throw new HttpError(400, 'audio file missing', 'VALIDATION');
    const fields = z
      .object({
        listen_count: z.coerce.number().int().min(0).max(99).default(0),
        takes_count: z.coerce.number().int().min(1).max(99).default(1),
        duration_ms: z.coerce.number().int().min(0).optional(),
      })
      .parse(req.body);
    const mime = req.file.mimetype || 'application/octet-stream';
    const durationMs = wavDurationMs(req.file.buffer) ?? fields.duration_ms ?? 0;
    if (durationMs < 500) throw new HttpError(400, 'Recording is empty', 'TOO_SHORT');
    const blobId = await storeBlob(req.file.buffer, mime);
    const hop = await submitAudio(a, {
      audioBlobId: blobId,
      audioMime: mime,
      durationMs,
      listenCount: fields.listen_count,
      takesCount: fields.takes_count,
    });
    res.json({ ok: true, hop_index: hop.hop_index });
  }),
);

tasksRouter.post(
  '/:id/abandon',
  wrap(async (req, res) => {
    const a = await getAssignmentForParticipant(Number(req.params.id), req.participant!.id);
    await abandon(a);
    res.json({ ok: true });
  }),
);
