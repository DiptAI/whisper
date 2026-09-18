import { config } from '../config.js';
import { recallSystemPrompt, recallUserPromptForText } from './prompts.js';

const BASE = 'https://api.groq.com/openai/v1';

function headers(): Record<string, string> {
  if (!config.groq.apiKey) throw new Error('GROQ_API_KEY is not set');
  return { authorization: `Bearer ${config.groq.apiKey}` };
}

interface GroqError {
  error?: { message?: string };
}

/** Whisper transcription (the note's "Whisper" hop). */
export async function groqTranscribe(audio: Buffer, mime: string, language: string): Promise<{ text: string; model: string }> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), mime.includes('wav') ? 'audio.wav' : 'audio.bin');
  form.append('model', config.groq.whisperModel);
  form.append('language', language);
  form.append('response_format', 'json');
  const res = await fetch(`${BASE}/audio/transcriptions`, { method: 'POST', headers: headers(), body: form });
  const json = (await res.json()) as { text?: string } & GroqError;
  if (!res.ok) throw new Error(`Groq whisper HTTP ${res.status}: ${json.error?.message ?? 'unknown error'}`);
  const text = json.text?.trim();
  if (!text) throw new Error('Groq whisper returned empty transcript');
  return { text, model: config.groq.whisperModel };
}

/** LLM recall via Groq-hosted Llama. */
export async function groqRecallText(text: string, language: string): Promise<{ text: string; model: string }> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { ...headers(), 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.groq.textModel,
      temperature: 0.8,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: recallSystemPrompt(language) },
        { role: 'user', content: recallUserPromptForText(text) },
      ],
    }),
  });
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> } & GroqError;
  if (!res.ok) throw new Error(`Groq chat HTTP ${res.status}: ${json.error?.message ?? 'unknown error'}`);
  const out = json.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('Groq chat returned empty content');
  return { text: out, model: config.groq.textModel };
}
