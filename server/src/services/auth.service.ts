import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../types.js';
import type { Participant } from '../types.js';

export const SESSION_COOKIE = 'wc_session';
const SESSION_DAYS = 30;
const PARTICIPANT_COLUMNS = [
  'id', 'google_sub', 'email', 'name', 'gender', 'study_level', 'consent_audio', 'consent_text', 'consented_at',
  'resume_code', 'preferred_language', 'created_at', 'last_seen_at',
] as const;

// Unambiguous alphabet (no 0/O, 1/I/L) for codes people may type from a printout.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateResumeCode(): string {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function normalizeResumeCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : raw.toUpperCase();
}

export function signSession(participantId: number): string {
  return jwt.sign({ pid: participantId }, config.sessionSecret, { expiresIn: `${SESSION_DAYS}d` });
}

export function verifySession(token: string): number | null {
  try {
    const payload = jwt.verify(token, config.sessionSecret) as { pid?: number };
    return typeof payload.pid === 'number' ? payload.pid : null;
  } catch {
    return null;
  }
}

export async function getParticipant(id: number): Promise<Participant | null> {
  const p = await db('participants').select(PARTICIPANT_COLUMNS).where({ id }).first<Participant>();
  return p ?? null;
}

async function createParticipant(fields: Partial<Participant>): Promise<Participant> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [p] = await db('participants')
        .insert({ ...fields, resume_code: generateResumeCode() })
        .returning<Participant[]>(PARTICIPANT_COLUMNS);
      return p;
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
    }
  }
  throw new HttpError(500, 'Could not allocate a resume code', 'CODE_COLLISION');
}

let googleClient: OAuth2Client | null = null;

export async function loginWithGoogle(credential: string): Promise<Participant> {
  if (!config.googleClientId) throw new HttpError(400, 'Google sign-in is not configured', 'GOOGLE_DISABLED');
  googleClient ??= new OAuth2Client(config.googleClientId);
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId }).catch(() => null);
  const payload = ticket?.getPayload();
  if (!payload?.sub) throw new HttpError(401, 'Invalid Google credential', 'BAD_GOOGLE_TOKEN');
  const existing = await db('participants').select(PARTICIPANT_COLUMNS).where({ google_sub: payload.sub }).first<Participant>();
  if (existing) {
    await db('participants').where({ id: existing.id }).update({ last_seen_at: db.fn.now() });
    return existing;
  }
  return createParticipant({ google_sub: payload.sub, email: payload.email ?? null, name: payload.name ?? null });
}

/** Local-testing login when Google is not configured. Keyed by email. */
export async function loginDev(email: string, name?: string): Promise<Participant> {
  if (!config.devLogin || config.googleClientId) throw new HttpError(400, 'Dev login is disabled', 'DEV_DISABLED');
  const sub = `dev:${email.toLowerCase()}`;
  const existing = await db('participants').select(PARTICIPANT_COLUMNS).where({ google_sub: sub }).first<Participant>();
  if (existing) return existing;
  return createParticipant({ google_sub: sub, email: email.toLowerCase(), name: name ?? null });
}

export async function loginWithResumeCode(code: string): Promise<Participant> {
  const p = await db('participants').select(PARTICIPANT_COLUMNS).where({ resume_code: normalizeResumeCode(code) }).first<Participant>();
  if (!p) throw new HttpError(404, 'Unknown resume code', 'BAD_CODE');
  await db('participants').where({ id: p.id }).update({ last_seen_at: db.fn.now() });
  return p;
}

export interface ProfileInput {
  name: string;
  gender: string;
  study_level: string;
  consent_audio: boolean;
  consent_text: boolean;
  preferred_language?: string;
}

export async function updateProfile(id: number, input: ProfileInput): Promise<Participant> {
  const [p] = await db('participants')
    .where({ id })
    .update({
      name: input.name,
      gender: input.gender,
      study_level: input.study_level,
      consent_audio: input.consent_audio,
      consent_text: input.consent_text,
      consented_at: input.consent_audio || input.consent_text ? db.fn.now() : null,
      preferred_language: input.preferred_language ?? null,
      last_seen_at: db.fn.now(),
    })
    .returning<Participant[]>(PARTICIPANT_COLUMNS);
  return p;
}

export async function resumeQrDataUrl(code: string, origin: string): Promise<string> {
  return QRCode.toDataURL(`${origin}/r/${code}`, { margin: 1, width: 240 });
}

export function hasProfile(p: Participant): boolean {
  return Boolean(p.name && p.gender && p.study_level && (p.consent_audio || p.consent_text));
}
