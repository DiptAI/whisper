import 'dotenv/config';

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be a number, got "${raw}"`);
  return n;
}

function str(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export type AudioModelKind = 'ALM' | 'WHISPER' | 'ALTERNATE';

export const config = {
  port: num('PORT', 3000),
  databaseUrl: str('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/whisper_chain'),
  sessionSecret: str('SESSION_SECRET', 'dev-only-secret-change-me'),
  adminToken: str('ADMIN_TOKEN', 'admin'),
  googleClientId: str('GOOGLE_CLIENT_ID'),
  devLogin: str('DEV_LOGIN', 'false') === 'true',

  maxHops: num('MAX_HOPS', 6),
  modelEveryN: num('MODEL_EVERY_N', 3),
  composition: {
    ALL_HUMAN: num('COMPOSITION_ALL_HUMAN', 0.3),
    ALL_MODEL: num('COMPOSITION_ALL_MODEL', 0.2),
    MIXED: num('COMPOSITION_MIXED', 0.5),
  },
  assignmentTtlMin: num('ASSIGNMENT_TTL_MIN', 20),
  maxAudioListens: num('MAX_AUDIO_LISTENS', 3),
  maxAudioTakes: num('MAX_AUDIO_TAKES', 3),
  maxAudioSeconds: num('MAX_AUDIO_SECONDS', 60),
  textReadSeconds: num('TEXT_READ_SECONDS', 300),
  /** extra network fetches tolerated beyond listens (reloads, seeks) */
  maxAudioFetches: num('MAX_AUDIO_FETCHES', 6),
  maxUploadBytes: num('MAX_UPLOAD_BYTES', 8 * 1024 * 1024),

  gemini: {
    apiKey: str('GEMINI_API_KEY'),
    textModel: str('GEMINI_TEXT_MODEL', 'gemini-2.5-flash'),
    ttsModel: str('GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts'),
    ttsVoice: str('GEMINI_TTS_VOICE', 'Kore'),
  },
  groq: {
    apiKey: str('GROQ_API_KEY'),
    whisperModel: str('GROQ_WHISPER_MODEL', 'whisper-large-v3-turbo'),
    textModel: str('GROQ_TEXT_MODEL', 'llama-3.3-70b-versatile'),
  },
  audioModelKind: str('AUDIO_MODEL_KIND', 'ALTERNATE') as AudioModelKind,
  modelWorkerIntervalMs: num('MODEL_WORKER_INTERVAL_MS', 15000),
};

export const LANGUAGES: ReadonlyArray<{ code: string; name: string; itc: string | null }> = [
  { code: 'en', name: 'English', itc: null },
  { code: 'bn', name: 'Bengali', itc: 'bn-t-i0-und' },
  { code: 'hi', name: 'Hindi', itc: 'hi-t-i0-und' },
  { code: 'ta', name: 'Tamil', itc: 'ta-t-i0-und' },
  { code: 'te', name: 'Telugu', itc: 'te-t-i0-und' },
  { code: 'mr', name: 'Marathi', itc: 'mr-t-i0-und' },
  { code: 'kn', name: 'Kannada', itc: 'kn-t-i0-und' },
  { code: 'ml', name: 'Malayalam', itc: 'ml-t-i0-und' },
  { code: 'gu', name: 'Gujarati', itc: 'gu-t-i0-und' },
  { code: 'pa', name: 'Punjabi', itc: 'pa-t-i0-und' },
  { code: 'or', name: 'Odia', itc: 'or-t-i0-und' },
  { code: 'as', name: 'Assamese', itc: 'as-t-i0-und' },
  { code: 'ur', name: 'Urdu', itc: 'ur-t-i0-und' },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}
