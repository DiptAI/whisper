import type { Knex } from 'knex';
import { config } from '../config.js';
import { db } from '../db.js';
import { HttpError } from '../types.js';
import type { Chain, Composition, ContributorType, Hop, JobKind, Modality } from '../types.js';
import { chooseComposition, isChainComplete, isModelHop, pickAudioJobKind, seedCode } from './chain-rules.js';

const HOP_COLUMNS = [
  'id', 'chain_id', 'hop_index', 'parent_hop_id', 'contributor_type', 'participant_id', 'model_name',
  'text_content', 'audio_blob_id', 'audio_mime', 'audio_duration_ms', 'listen_count', 'takes_count',
  'read_seconds', 'metadata', 'created_at',
] as const;
const CHAIN_COLUMNS = ['id', 'code', 'modality', 'language', 'composition', 'max_hops', 'status', 'created_at'] as const;

export interface NewSeedInput {
  modality: Modality;
  language: string;
  composition?: Composition;
  text?: string;
  audioBlobId?: number;
  audioMime?: string;
  audioDurationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface NewHopInput {
  chainId: number;
  parentHopId: number;
  contributorType: Exclude<ContributorType, 'SEED'>;
  participantId?: number;
  modelName?: string;
  text?: string | null;
  audioBlobId?: number | null;
  audioMime?: string | null;
  audioDurationMs?: number | null;
  listenCount?: number | null;
  takesCount?: number | null;
  readSeconds?: number | null;
  metadata?: Record<string, unknown>;
}

export async function getChain(id: number, trx: Knex = db): Promise<Chain> {
  const chain = await trx('chains').select(CHAIN_COLUMNS).where({ id }).first<Chain>();
  if (!chain) throw new HttpError(404, 'Chain not found', 'CHAIN_NOT_FOUND');
  return chain;
}

export async function getHop(id: number, trx: Knex = db): Promise<Hop> {
  const hop = await trx('hops').select(HOP_COLUMNS).where({ id }).first<Hop>();
  if (!hop) throw new HttpError(404, 'Hop not found', 'HOP_NOT_FOUND');
  return hop;
}

export async function getHead(chainId: number, trx: Knex = db): Promise<Hop> {
  const hop = await trx('hops').select(HOP_COLUMNS).where({ chain_id: chainId }).orderBy('hop_index', 'desc').first<Hop>();
  if (!hop) throw new HttpError(500, `Chain ${chainId} has no seed hop`, 'CHAIN_EMPTY');
  return hop;
}

export async function listHops(chainId: number): Promise<Hop[]> {
  return db('hops').select(HOP_COLUMNS).where({ chain_id: chainId }).orderBy('hop_index', 'asc');
}

/** Create a chain with its seed (hop 0). Enqueues the first model job for ALL_MODEL chains. */
export async function createSeed(input: NewSeedInput): Promise<{ chain: Chain; seed: Hop }> {
  if (input.modality === 'TEXT' && !input.text?.trim()) throw new HttpError(400, 'TEXT seed needs text', 'VALIDATION');
  if (input.modality === 'AUDIO' && !input.audioBlobId) throw new HttpError(400, 'AUDIO seed needs an audio file', 'VALIDATION');

  return db.transaction(async (trx) => {
    // next sequence number per (modality, language)
    await trx.raw('LOCK TABLE chains IN SHARE ROW EXCLUSIVE MODE');
    const countRow = await trx('chains')
      .where({ modality: input.modality, language: input.language })
      .count<{ count: string }[]>('id as count')
      .first();
    const n = Number(countRow?.count ?? 0) + 1;
    const composition = input.composition ?? chooseComposition(config.composition);
    const [chain] = await trx('chains')
      .insert({
        code: seedCode(input.modality, input.language, n),
        modality: input.modality,
        language: input.language,
        composition,
        max_hops: config.maxHops,
        status: 'OPEN',
      })
      .returning<Chain[]>(CHAIN_COLUMNS);
    const [seed] = await trx('hops')
      .insert({
        chain_id: chain.id,
        hop_index: 0,
        parent_hop_id: null,
        contributor_type: 'SEED',
        text_content: input.text ?? null,
        audio_blob_id: input.audioBlobId ?? null,
        audio_mime: input.audioMime ?? null,
        audio_duration_ms: input.audioDurationMs ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
      })
      .returning<Hop[]>(HOP_COLUMNS);
    await afterHopCreated(chain, seed, trx);
    return { chain, seed };
  });
}

/** Append a hop to a chain. Caller must hold the chain (assignment or model job). */
export async function appendHop(input: NewHopInput, trx: Knex = db): Promise<Hop> {
  const parent = await getHop(input.parentHopId, trx);
  if (parent.chain_id !== input.chainId) throw new HttpError(400, 'Parent hop belongs to another chain', 'VALIDATION');
  const head = await getHead(input.chainId, trx);
  if (head.id !== parent.id) throw new HttpError(409, 'Chain has moved on since this hop was assigned', 'STALE_HEAD');
  const [hop] = await trx('hops')
    .insert({
      chain_id: input.chainId,
      hop_index: parent.hop_index + 1,
      parent_hop_id: parent.id,
      contributor_type: input.contributorType,
      participant_id: input.participantId ?? null,
      model_name: input.modelName ?? null,
      text_content: input.text ?? null,
      audio_blob_id: input.audioBlobId ?? null,
      audio_mime: input.audioMime ?? null,
      audio_duration_ms: input.audioDurationMs ?? null,
      listen_count: input.listenCount ?? null,
      takes_count: input.takesCount ?? null,
      read_seconds: input.readSeconds ?? null,
      metadata: JSON.stringify(input.metadata ?? {}),
    })
    .returning<Hop[]>(HOP_COLUMNS);
  const chain = await getChain(input.chainId, trx);
  await afterHopCreated(chain, hop, trx);
  return hop;
}

/**
 * Decide what happens after a hop lands: complete the chain, queue a model
 * hop, or leave the head in the human pool.
 */
export async function afterHopCreated(chain: Chain, hop: Hop, trx: Knex): Promise<void> {
  if (isChainComplete(hop.hop_index, chain.max_hops)) {
    await trx('chains').where({ id: chain.id }).update({ status: 'COMPLETE' });
    return;
  }
  const nextIndex = hop.hop_index + 1;
  if (isModelHop(chain.composition, nextIndex, { maxHops: chain.max_hops, modelEveryN: config.modelEveryN })) {
    const kind: JobKind =
      chain.modality === 'TEXT'
        ? 'LLM_TEXT'
        : pickAudioJobKind(config.audioModelKind, nextIndex, {
            gemini: Boolean(config.gemini.apiKey),
            groq: Boolean(config.groq.apiKey),
          });
    await trx('model_jobs').insert({ chain_id: chain.id, parent_hop_id: hop.id, kind, status: 'PENDING' });
  }
}

export interface ChainSummary extends Chain {
  head_hop_index: number;
  human_hops: number;
  model_hops: number;
  active_assignment: boolean;
  pending_job: boolean;
}

export async function listChainSummaries(filters: { modality?: Modality; language?: string } = {}): Promise<ChainSummary[]> {
  const q = db('chains as c')
    .select(
      'c.id', 'c.code', 'c.modality', 'c.language', 'c.composition', 'c.max_hops', 'c.status', 'c.created_at',
      db.raw('(SELECT MAX(h.hop_index) FROM hops h WHERE h.chain_id = c.id) AS head_hop_index'),
      db.raw("(SELECT COUNT(*) FROM hops h WHERE h.chain_id = c.id AND h.contributor_type = 'HUMAN')::int AS human_hops"),
      db.raw("(SELECT COUNT(*) FROM hops h WHERE h.chain_id = c.id AND h.contributor_type = 'MODEL')::int AS model_hops"),
      db.raw("EXISTS(SELECT 1 FROM assignments a WHERE a.chain_id = c.id AND a.status = 'ACTIVE' AND a.expires_at > now()) AS active_assignment"),
      db.raw("EXISTS(SELECT 1 FROM model_jobs j WHERE j.chain_id = c.id AND j.status IN ('PENDING','RUNNING')) AS pending_job"),
    )
    .orderBy(['c.modality', 'c.language', 'c.code']);
  if (filters.modality) void q.where('c.modality', filters.modality);
  if (filters.language) void q.where('c.language', filters.language);
  return q;
}
