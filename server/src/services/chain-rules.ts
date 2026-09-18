/**
 * Pure, side-effect free rules for how a chain grows.
 * Everything that is a "research decision" lives here so it can be unit tested
 * and tweaked without touching the database code.
 */
import type { Composition, JobKind } from '../types.js';
import type { AudioModelKind } from '../config.js';

export interface ChainRuleConfig {
  maxHops: number;
  modelEveryN: number;
}

/** Is hop number `hopIndex` (1-based, seed = 0) produced by a model in this chain? */
export function isModelHop(composition: Composition, hopIndex: number, cfg: ChainRuleConfig): boolean {
  if (hopIndex <= 0) return false;
  if (composition === 'ALL_MODEL') return true;
  if (composition === 'ALL_HUMAN') return false;
  // MIXED: fixed rate — every Nth hop is a model hop (N=3 -> hops 3, 6, 9 ...)
  return cfg.modelEveryN > 0 && hopIndex % cfg.modelEveryN === 0;
}

export function isChainComplete(headHopIndex: number, maxHops: number): boolean {
  return headHopIndex >= maxHops;
}

/** Candidate chain head as seen by the assignment picker. */
export interface HeadCandidate {
  chainId: number;
  headHopIndex: number;
}

/**
 * Weight for the probabilistic pick. Deeper chains get a higher weight so that
 * a limited participant pool produces some genuinely long chains instead of
 * 100 chains of length one. Weight = 1 + depth.
 */
export function headWeight(headHopIndex: number): number {
  return 1 + Math.max(0, headHopIndex);
}

/** Weighted random choice. `rand` in [0,1) is injected so tests are deterministic. */
export function pickWeighted<T extends HeadCandidate>(candidates: T[], rand: () => number = Math.random): T | null {
  if (candidates.length === 0) return null;
  const weights = candidates.map((c) => headWeight(c.headHopIndex));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

export interface CompositionProbabilities {
  ALL_HUMAN: number;
  ALL_MODEL: number;
  MIXED: number;
}

/** Choose a composition for a new seed chain according to configured proportions. */
export function chooseComposition(p: CompositionProbabilities, rand: () => number = Math.random): Composition {
  const total = p.ALL_HUMAN + p.ALL_MODEL + p.MIXED;
  if (total <= 0) return 'MIXED';
  let r = rand() * total;
  r -= p.ALL_HUMAN;
  if (r < 0) return 'ALL_HUMAN';
  r -= p.ALL_MODEL;
  if (r < 0) return 'ALL_MODEL';
  return 'MIXED';
}

export interface ProviderAvailability {
  gemini: boolean;
  groq: boolean;
}

/**
 * Which pipeline should produce the next model hop in an AUDIO chain.
 * ALTERNATE flips between ALM (Gemini listens directly) and WHISPER (Groq
 * Whisper -> LLM -> TTS) per model hop, falling back to whichever key exists.
 */
export function pickAudioJobKind(
  kind: AudioModelKind,
  hopIndex: number,
  avail: ProviderAvailability,
): JobKind {
  const canAlm = avail.gemini;
  const canWhisper = avail.groq && avail.gemini; // TTS still needs Gemini
  if (kind === 'ALM') return canAlm ? 'ALM_AUDIO' : 'WHISPER_AUDIO';
  if (kind === 'WHISPER') return canWhisper ? 'WHISPER_AUDIO' : 'ALM_AUDIO';
  if (canAlm && canWhisper) return hopIndex % 2 === 0 ? 'ALM_AUDIO' : 'WHISPER_AUDIO';
  return canWhisper ? 'WHISPER_AUDIO' : 'ALM_AUDIO';
}

export function seedCode(modality: 'AUDIO' | 'TEXT', language: string, n: number): string {
  const prefix = modality === 'AUDIO' ? 'AUD' : 'TXT';
  return `${prefix}-${language.toUpperCase()}-${String(n).padStart(3, '0')}`;
}
