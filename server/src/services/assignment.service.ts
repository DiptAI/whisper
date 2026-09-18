import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../types.js';
import type { Assignment, Chain, Hop, Modality } from '../types.js';
import { isModelHop, pickWeighted } from './chain-rules.js';
import { appendHop, getChain, getHead, getHop } from './chains.service.js';

const ASSIGNMENT_COLUMNS = [
  'id', 'participant_id', 'chain_id', 'source_hop_id', 'modality', 'status', 'expires_at', 'content_fetches',
  'reading_started_at', 'reading_hidden_at', 'submitted_hop_id', 'created_at', 'updated_at',
] as const;

export interface AssignmentView {
  id: number;
  modality: Modality;
  language: string;
  chain_code: string;
  hop_index: number; // the hop the participant will produce
  expires_at: Date;
  status: Assignment['status'];
  content_fetches: number;
  reading_started_at: Date | null;
  reading_hidden_at: Date | null;
  reading_deadline: Date | null;
  limits: {
    max_listens: number;
    max_takes: number;
    max_audio_seconds: number;
    text_read_seconds: number;
  };
}

/** Release stale leases so their chain heads return to the pool. */
export async function expireStaleAssignments(): Promise<number> {
  const n = await db('assignments')
    .where('status', 'ACTIVE')
    .andWhere('expires_at', '<', db.fn.now())
    .update({ status: 'EXPIRED', updated_at: db.fn.now() });
  return n;
}

export async function getActiveAssignment(participantId: number, modality?: Modality): Promise<Assignment | null> {
  await expireStaleAssignments();
  const q = db('assignments')
    .select(ASSIGNMENT_COLUMNS)
    .where({ participant_id: participantId, status: 'ACTIVE' })
    .orderBy('created_at', 'desc');
  if (modality) void q.andWhere({ modality });
  return (await q.first<Assignment>()) ?? null;
}

export async function hasSubmitted(participantId: number, modality: Modality): Promise<boolean> {
  const row = await db('assignments').select('id').where({ participant_id: participantId, modality, status: 'SUBMITTED' }).first();
  return Boolean(row);
}

export async function getAssignmentForParticipant(id: number, participantId: number): Promise<Assignment> {
  const a = await db('assignments').select(ASSIGNMENT_COLUMNS).where({ id, participant_id: participantId }).first<Assignment>();
  if (!a) throw new HttpError(404, 'Task not found', 'TASK_NOT_FOUND');
  return a;
}

export async function toView(a: Assignment): Promise<AssignmentView> {
  const chain = await getChain(a.chain_id);
  const source = await getHop(a.source_hop_id);
  const readingDeadline = a.reading_started_at
    ? new Date(a.reading_started_at.getTime() + config.textReadSeconds * 1000)
    : null;
  return {
    id: a.id,
    modality: a.modality,
    language: chain.language,
    chain_code: chain.code,
    hop_index: source.hop_index + 1,
    expires_at: a.expires_at,
    status: a.status,
    content_fetches: a.content_fetches,
    reading_started_at: a.reading_started_at,
    reading_hidden_at: a.reading_hidden_at,
    reading_deadline: readingDeadline,
    limits: {
      max_listens: config.maxAudioListens,
      max_takes: config.maxAudioTakes,
      max_audio_seconds: config.maxAudioSeconds,
      text_read_seconds: config.textReadSeconds,
    },
  };
}

interface CandidateRow {
  chain_id: number;
  head_hop_index: number;
  head_hop_id: number;
  composition: Chain['composition'];
  max_hops: number;
}

/**
 * Chains this participant may receive next:
 *  - same modality + language, still OPEN, not ALL_MODEL
 *  - head not currently leased (ACTIVE, unexpired) and no model job in flight
 *  - the next hop is a human hop
 *  - the participant has never contributed to, or been assigned, this chain
 *    (the note's "U1 did A00 -> never gets A12..A15" rule)
 */
export async function findCandidates(participantId: number, modality: Modality, language: string): Promise<CandidateRow[]> {
  const rows = await db('chains as c')
    .select<CandidateRow[]>(
      'c.id as chain_id',
      'c.composition',
      'c.max_hops',
      'h.hop_index as head_hop_index',
      'h.id as head_hop_id',
    )
    .join('hops as h', function () {
      this.on('h.chain_id', '=', 'c.id').andOn(
        'h.hop_index',
        '=',
        db.raw('(SELECT MAX(h2.hop_index) FROM hops h2 WHERE h2.chain_id = c.id)'),
      );
    })
    .where({ 'c.modality': modality, 'c.language': language, 'c.status': 'OPEN' })
    .whereNot('c.composition', 'ALL_MODEL')
    .whereNotExists(
      db('assignments as a')
        .select(db.raw('1'))
        .whereRaw('a.chain_id = c.id')
        .andWhere('a.status', 'ACTIVE')
        .andWhere('a.expires_at', '>', db.fn.now()),
    )
    .whereNotExists(
      db('model_jobs as j').select(db.raw('1')).whereRaw('j.chain_id = c.id').whereIn('j.status', ['PENDING', 'RUNNING']),
    )
    .whereNotExists(
      db('hops as mine').select(db.raw('1')).whereRaw('mine.chain_id = c.id').andWhere('mine.participant_id', participantId),
    )
    .whereNotExists(
      db('assignments as a2')
        .select(db.raw('1'))
        .whereRaw('a2.chain_id = c.id')
        .andWhere('a2.participant_id', participantId)
        .whereIn('a2.status', ['ACTIVE', 'SUBMITTED']),
    );
  const ruleCfg = { maxHops: config.maxHops, modelEveryN: config.modelEveryN };
  return rows.filter(
    (r) => r.head_hop_index < r.max_hops && !isModelHop(r.composition, r.head_hop_index + 1, ruleCfg),
  );
}

/**
 * Start (or resume) a task. One submitted task per modality per participant.
 * The pick is probabilistic: weighted random over eligible chain heads.
 */
export async function startTask(participantId: number, modality: Modality, language: string): Promise<AssignmentView> {
  if (await hasSubmitted(participantId, modality)) {
    throw new HttpError(409, `You have already completed the ${modality.toLowerCase()} task`, 'ALREADY_DONE');
  }
  const existing = await getActiveAssignment(participantId, modality);
  if (existing) return toView(existing);
  // Only one active task at a time across modalities.
  const otherActive = await getActiveAssignment(participantId);
  if (otherActive) throw new HttpError(409, 'Finish or abandon your current task first', 'TASK_IN_PROGRESS');

  // Retry a few times: two participants may race for the same head.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidates = await findCandidates(participantId, modality, language);
    const picked = pickWeighted(candidates.map((c) => ({ ...c, chainId: c.chain_id, headHopIndex: c.head_hop_index })));
    if (!picked) throw new HttpError(404, 'No items are available for this language right now', 'NO_ITEMS');
    try {
      const [a] = await db('assignments')
        .insert({
          participant_id: participantId,
          chain_id: picked.chain_id,
          source_hop_id: picked.head_hop_id,
          modality,
          status: 'ACTIVE',
          expires_at: new Date(Date.now() + config.assignmentTtlMin * 60 * 1000),
        })
        .returning<Assignment[]>(ASSIGNMENT_COLUMNS);
      return toView(a);
    } catch (err) {
      if (isUniqueViolation(err)) continue; // lost the race, pick again
      throw err;
    }
  }
  throw new HttpError(503, 'Could not reserve an item, please try again', 'BUSY');
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

function assertActive(a: Assignment): void {
  if (a.status !== 'ACTIVE') throw new HttpError(409, 'This task is no longer active', 'TASK_INACTIVE');
  if (a.expires_at.getTime() < Date.now()) throw new HttpError(409, 'This task has expired', 'TASK_EXPIRED');
}

/** Serve the source audio; bounded number of fetches per assignment. */
export async function fetchSourceAudio(a: Assignment): Promise<{ bytes: Buffer; mime: string }> {
  assertActive(a);
  if (a.modality !== 'AUDIO') throw new HttpError(400, 'Not an audio task', 'WRONG_MODALITY');
  const updated = await db('assignments')
    .where({ id: a.id })
    .andWhere('content_fetches', '<', config.maxAudioFetches)
    .increment('content_fetches', 1);
  if (!updated) throw new HttpError(403, 'Listening limit reached', 'LISTEN_LIMIT');
  const source = await getHop(a.source_hop_id);
  if (!source.audio_blob_id) throw new HttpError(500, 'Source hop has no audio', 'NO_AUDIO');
  const blob = await db('blobs').select('bytes', 'mime').where({ id: source.audio_blob_id }).first<{ bytes: Buffer; mime: string }>();
  if (!blob) throw new HttpError(500, 'Audio blob missing', 'NO_AUDIO');
  return blob;
}

/** Serve the source text; starts the reading clock on first fetch, refuses once hidden or timed out. */
export async function fetchSourceText(a: Assignment): Promise<{ text: string; reading_deadline: Date }> {
  assertActive(a);
  if (a.modality !== 'TEXT') throw new HttpError(400, 'Not a text task', 'WRONG_MODALITY');
  if (a.reading_hidden_at) throw new HttpError(403, 'The text has been hidden', 'TEXT_HIDDEN');
  let startedAt = a.reading_started_at;
  if (!startedAt) {
    startedAt = new Date();
    await db('assignments').where({ id: a.id }).update({
      reading_started_at: startedAt,
      content_fetches: a.content_fetches + 1,
      updated_at: db.fn.now(),
    });
  }
  const deadline = new Date(startedAt.getTime() + config.textReadSeconds * 1000);
  if (deadline.getTime() < Date.now()) {
    await db('assignments').where({ id: a.id }).update({ reading_hidden_at: deadline, updated_at: db.fn.now() });
    throw new HttpError(403, 'Reading time is over', 'TEXT_HIDDEN');
  }
  const source = await getHop(a.source_hop_id);
  return { text: source.text_content ?? '', reading_deadline: deadline };
}

export async function hideText(a: Assignment): Promise<void> {
  assertActive(a);
  if (a.reading_hidden_at) return;
  await db('assignments').where({ id: a.id }).update({ reading_hidden_at: db.fn.now(), updated_at: db.fn.now() });
}

export interface SubmitTextInput {
  text: string;
}
export interface SubmitAudioInput {
  audioBlobId: number;
  audioMime: string;
  durationMs: number;
  listenCount: number;
  takesCount: number;
}

export async function submitText(a: Assignment, input: SubmitTextInput): Promise<Hop> {
  assertActive(a);
  if (a.modality !== 'TEXT') throw new HttpError(400, 'Not a text task', 'WRONG_MODALITY');
  if (!a.reading_started_at) throw new HttpError(409, 'Read the text before writing', 'NOT_READ');
  const text = input.text.trim();
  if (!text) throw new HttpError(400, 'Nothing was written', 'VALIDATION');
  const hiddenAt = a.reading_hidden_at ?? new Date();
  const readSeconds = Math.round((hiddenAt.getTime() - a.reading_started_at.getTime()) / 1000);
  return db.transaction(async (trx) => {
    const hop = await appendHop(
      {
        chainId: a.chain_id,
        parentHopId: a.source_hop_id,
        contributorType: 'HUMAN',
        participantId: a.participant_id,
        text,
        readSeconds: Math.min(readSeconds, config.textReadSeconds),
      },
      trx,
    );
    await trx('assignments').where({ id: a.id }).update({
      status: 'SUBMITTED',
      submitted_hop_id: hop.id,
      reading_hidden_at: hiddenAt,
      updated_at: trx.fn.now(),
    });
    return hop;
  });
}

export async function submitAudio(a: Assignment, input: SubmitAudioInput): Promise<Hop> {
  assertActive(a);
  if (a.modality !== 'AUDIO') throw new HttpError(400, 'Not an audio task', 'WRONG_MODALITY');
  if (input.durationMs > (config.maxAudioSeconds + 2) * 1000) {
    throw new HttpError(400, `Recording longer than ${config.maxAudioSeconds}s`, 'TOO_LONG');
  }
  return db.transaction(async (trx) => {
    const hop = await appendHop(
      {
        chainId: a.chain_id,
        parentHopId: a.source_hop_id,
        contributorType: 'HUMAN',
        participantId: a.participant_id,
        audioBlobId: input.audioBlobId,
        audioMime: input.audioMime,
        audioDurationMs: input.durationMs,
        listenCount: Math.min(input.listenCount, config.maxAudioListens),
        takesCount: Math.min(input.takesCount, config.maxAudioTakes),
      },
      trx,
    );
    await trx('assignments').where({ id: a.id }).update({ status: 'SUBMITTED', submitted_hop_id: hop.id, updated_at: trx.fn.now() });
    return hop;
  });
}

export async function abandon(a: Assignment): Promise<void> {
  if (a.status !== 'ACTIVE') return;
  await db('assignments').where({ id: a.id }).update({ status: 'ABANDONED', updated_at: db.fn.now() });
}

/** Whether items exist in the pool for this participant (used by the home screen). */
export async function availability(participantId: number, language: string): Promise<Record<Modality, number>> {
  const [audio, text] = await Promise.all([
    findCandidates(participantId, 'AUDIO', language),
    findCandidates(participantId, 'TEXT', language),
  ]);
  return { AUDIO: audio.length, TEXT: text.length };
}

export { getHead };
