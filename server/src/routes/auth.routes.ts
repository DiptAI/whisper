import { Router } from 'express';
import { z } from 'zod';
import { config, LANGUAGES, LANGUAGE_CODES } from '../config.js';
import { HttpError } from '../types.js';
import type { Participant } from '../types.js';
import { requireParticipant, requestOrigin, wrap } from '../middleware.js';
import {
  SESSION_COOKIE, hasProfile, loginDev, loginWithGoogle, loginWithResumeCode, resumeQrDataUrl, signSession, updateProfile,
} from '../services/auth.service.js';
import { availability, getActiveAssignment, hasSubmitted, toView } from '../services/assignment.service.js';
import { providersConfigured } from '../services/model-worker.js';

export const authRouter = Router();

function setSession(res: import('express').Response, p: Participant): void {
  res.cookie(SESSION_COOKIE, signSession(p.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

function publicParticipant(p: Participant) {
  return {
    id: p.id,
    email: p.email,
    name: p.name,
    gender: p.gender,
    study_level: p.study_level,
    consent_audio: p.consent_audio,
    consent_text: p.consent_text,
    preferred_language: p.preferred_language,
    resume_code: p.resume_code,
    profile_complete: hasProfile(p),
  };
}

authRouter.get('/config', (_req, res) => {
  res.json({
    google_client_id: config.googleClientId || null,
    dev_login: config.devLogin && !config.googleClientId,
    languages: LANGUAGES.map((l) => ({ code: l.code, name: l.name, transliterate: Boolean(l.itc) })),
    model_hops_enabled: providersConfigured(),
    limits: {
      max_listens: config.maxAudioListens,
      max_takes: config.maxAudioTakes,
      max_audio_seconds: config.maxAudioSeconds,
      text_read_seconds: config.textReadSeconds,
    },
  });
});

authRouter.post(
  '/auth/google',
  wrap(async (req, res) => {
    const body = z.object({ credential: z.string().min(10) }).parse(req.body);
    const p = await loginWithGoogle(body.credential);
    setSession(res, p);
    res.json({ participant: publicParticipant(p) });
  }),
);

authRouter.post(
  '/auth/dev',
  wrap(async (req, res) => {
    const body = z.object({ email: z.string().email(), name: z.string().max(200).optional() }).parse(req.body);
    const p = await loginDev(body.email, body.name);
    setSession(res, p);
    res.json({ participant: publicParticipant(p) });
  }),
);

authRouter.post(
  '/auth/resume',
  wrap(async (req, res) => {
    const body = z.object({ code: z.string().min(6).max(12) }).parse(req.body);
    const p = await loginWithResumeCode(body.code);
    setSession(res, p);
    res.json({ participant: publicParticipant(p) });
  }),
);

authRouter.post('/auth/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  requireParticipant,
  wrap(async (req, res) => {
    const p = req.participant!;
    const active = await getActiveAssignment(p.id);
    const language = (req.query.language as string | undefined) ?? p.preferred_language ?? 'en';
    const [doneAudio, doneText, avail] = await Promise.all([
      hasSubmitted(p.id, 'AUDIO'),
      hasSubmitted(p.id, 'TEXT'),
      LANGUAGE_CODES.includes(language) ? availability(p.id, language) : Promise.resolve({ AUDIO: 0, TEXT: 0 }),
    ]);
    res.json({
      participant: publicParticipant(p),
      active_task: active ? await toView(active) : null,
      progress: { AUDIO: doneAudio ? 'DONE' : 'TODO', TEXT: doneText ? 'DONE' : 'TODO' },
      availability: avail,
    });
  }),
);

authRouter.put(
  '/me/profile',
  requireParticipant,
  wrap(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(200),
        gender: z.string().trim().min(1).max(40),
        study_level: z.string().trim().min(1).max(80),
        consent_audio: z.boolean(),
        consent_text: z.boolean(),
        preferred_language: z.enum(LANGUAGE_CODES as [string, ...string[]]).optional(),
      })
      .parse(req.body);
    if (!body.consent_audio && !body.consent_text) throw new HttpError(400, 'Consent to at least one modality', 'NO_CONSENT');
    const p = await updateProfile(req.participant!.id, body);
    res.json({ participant: publicParticipant(p) });
  }),
);

authRouter.get(
  '/me/resume-code',
  requireParticipant,
  wrap(async (req, res) => {
    const p = req.participant!;
    const origin = requestOrigin(req);
    res.json({ code: p.resume_code, url: `${origin}/r/${p.resume_code}`, qr: await resumeQrDataUrl(p.resume_code, origin) });
  }),
);
