import { describe, expect, it } from 'vitest';
import {
  chooseComposition,
  headWeight,
  isChainComplete,
  isModelHop,
  pickAudioJobKind,
  pickWeighted,
  seedCode,
} from './chain-rules.js';

const cfg = { maxHops: 6, modelEveryN: 3 };

describe('isModelHop', () => {
  it('seed is never a model hop', () => {
    expect(isModelHop('ALL_MODEL', 0, cfg)).toBe(false);
  });
  it('ALL_HUMAN never has model hops', () => {
    for (let i = 1; i <= 6; i++) expect(isModelHop('ALL_HUMAN', i, cfg)).toBe(false);
  });
  it('ALL_MODEL always has model hops', () => {
    for (let i = 1; i <= 6; i++) expect(isModelHop('ALL_MODEL', i, cfg)).toBe(true);
  });
  it('MIXED uses every Nth hop', () => {
    const got = [1, 2, 3, 4, 5, 6].map((i) => isModelHop('MIXED', i, cfg));
    expect(got).toEqual([false, false, true, false, false, true]);
  });
  it('MIXED with modelEveryN=0 behaves as all human', () => {
    expect(isModelHop('MIXED', 3, { maxHops: 6, modelEveryN: 0 })).toBe(false);
  });
});

describe('isChainComplete', () => {
  it('completes when head reaches maxHops', () => {
    expect(isChainComplete(5, 6)).toBe(false);
    expect(isChainComplete(6, 6)).toBe(true);
  });
});

describe('pickWeighted', () => {
  it('returns null for empty candidates', () => {
    expect(pickWeighted([], () => 0.5)).toBeNull();
  });
  it('prefers deeper heads (weight 1 + depth)', () => {
    expect(headWeight(0)).toBe(1);
    expect(headWeight(4)).toBe(5);
    const cands = [
      { chainId: 1, headHopIndex: 0 }, // weight 1
      { chainId: 2, headHopIndex: 3 }, // weight 4
    ];
    // total 5: r in [0,1) -> chain 1, r in [1,5) -> chain 2
    expect(pickWeighted(cands, () => 0.1)?.chainId).toBe(1); // 0.5
    expect(pickWeighted(cands, () => 0.3)?.chainId).toBe(2); // 1.5
    expect(pickWeighted(cands, () => 0.99)?.chainId).toBe(2);
  });
  it('is statistically proportional to weight', () => {
    const cands = [
      { chainId: 1, headHopIndex: 0 },
      { chainId: 2, headHopIndex: 1 },
    ];
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let twos = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) if (pickWeighted(cands, rand)?.chainId === 2) twos++;
    expect(twos / N).toBeGreaterThan(0.63);
    expect(twos / N).toBeLessThan(0.7);
  });
});

describe('chooseComposition', () => {
  const p = { ALL_HUMAN: 0.3, ALL_MODEL: 0.2, MIXED: 0.5 };
  it('maps rand ranges to compositions', () => {
    expect(chooseComposition(p, () => 0.1)).toBe('ALL_HUMAN');
    expect(chooseComposition(p, () => 0.4)).toBe('ALL_MODEL');
    expect(chooseComposition(p, () => 0.9)).toBe('MIXED');
  });
  it('defaults to MIXED when all probabilities are zero', () => {
    expect(chooseComposition({ ALL_HUMAN: 0, ALL_MODEL: 0, MIXED: 0 })).toBe('MIXED');
  });
});

describe('pickAudioJobKind', () => {
  it('alternates when both providers exist', () => {
    const avail = { gemini: true, groq: true };
    expect(pickAudioJobKind('ALTERNATE', 2, avail)).toBe('ALM_AUDIO');
    expect(pickAudioJobKind('ALTERNATE', 3, avail)).toBe('WHISPER_AUDIO');
  });
  it('falls back to ALM when Groq is missing', () => {
    expect(pickAudioJobKind('WHISPER', 3, { gemini: true, groq: false })).toBe('ALM_AUDIO');
    expect(pickAudioJobKind('ALTERNATE', 3, { gemini: true, groq: false })).toBe('ALM_AUDIO');
  });
  it('honours explicit kinds when available', () => {
    expect(pickAudioJobKind('ALM', 3, { gemini: true, groq: true })).toBe('ALM_AUDIO');
    expect(pickAudioJobKind('WHISPER', 2, { gemini: true, groq: true })).toBe('WHISPER_AUDIO');
  });
});

describe('seedCode', () => {
  it('formats modality, language and number', () => {
    expect(seedCode('AUDIO', 'bn', 1)).toBe('AUD-BN-001');
    expect(seedCode('TEXT', 'hi', 42)).toBe('TXT-HI-042');
  });
});
