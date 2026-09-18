import { config } from '../config.js';
import { pcmRateFromMime, pcmToWav } from './wav.js';
import { recallSystemPrompt, recallUserPromptForAudio, recallUserPromptForText } from './prompts.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}
interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

async function call(model: string, body: unknown): Promise<GeminiResponse> {
  if (!config.gemini.apiKey) throw new Error('GEMINI_API_KEY is not set');
  const res = await fetch(`${BASE}/${model}:generateContent?key=${encodeURIComponent(config.gemini.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as GeminiResponse;
  if (!res.ok) throw new Error(`Gemini ${model} HTTP ${res.status}: ${json.error?.message ?? 'unknown error'}`);
  if (json.promptFeedback?.blockReason) throw new Error(`Gemini blocked prompt: ${json.promptFeedback.blockReason}`);
  return json;
}

function firstText(json: GeminiResponse): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  if (!text) throw new Error('Gemini returned no text');
  return text;
}

/** LLM hop for TEXT chains. */
export async function geminiRecallText(text: string, language: string): Promise<{ text: string; model: string }> {
  const json = await call(config.gemini.textModel, {
    systemInstruction: { parts: [{ text: recallSystemPrompt(language) }] },
    contents: [{ role: 'user', parts: [{ text: recallUserPromptForText(text) }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
  });
  return { text: firstText(json), model: config.gemini.textModel };
}

/** ALM hop: Gemini listens to the audio directly and recalls it as text. */
export async function geminiRecallAudio(audio: Buffer, mime: string, language: string): Promise<{ text: string; model: string }> {
  const json = await call(config.gemini.textModel, {
    systemInstruction: { parts: [{ text: recallSystemPrompt(language) }] },
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType: mime, data: audio.toString('base64') } }, { text: recallUserPromptForAudio() }],
      },
    ],
    generationConfig: { temperature: 0.8, maxOutputTokens: 2048 },
  });
  return { text: firstText(json), model: config.gemini.textModel };
}

/** Text to speech via Gemini TTS. Returns a WAV buffer. */
export async function geminiTts(text: string): Promise<{ wav: Buffer; model: string }> {
  const json = await call(config.gemini.ttsModel, {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.gemini.ttsVoice } } },
    },
  });
  const part = (json.candidates?.[0]?.content?.parts ?? []).find((p) => p.inlineData);
  if (!part?.inlineData) throw new Error('Gemini TTS returned no audio');
  const pcm = Buffer.from(part.inlineData.data, 'base64');
  const mime = part.inlineData.mimeType;
  if (mime.startsWith('audio/wav')) return { wav: pcm, model: config.gemini.ttsModel };
  return { wav: pcmToWav(pcm, pcmRateFromMime(mime)), model: config.gemini.ttsModel };
}
