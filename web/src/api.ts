export interface ApiError {
  code: string;
  message: string;
}

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let err: ApiError = { code: 'HTTP_' + res.status, message: res.statusText };
  try {
    const body = (await res.json()) as { error?: ApiError };
    if (body.error) err = body.error;
  } catch {
    /* non-JSON error body */
  }
  throw new ApiRequestError(res.status, err.code, err.message);
}

export async function get<T>(url: string): Promise<T> {
  return handle<T>(await fetch(url, { credentials: 'same-origin' }));
}

export async function post<T>(url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  return handle<T>(
    await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function put<T>(url: string, body: unknown): Promise<T> {
  return handle<T>(
    await fetch(url, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );
}

export async function postForm<T>(url: string, form: FormData, headers: Record<string, string> = {}): Promise<T> {
  return handle<T>(await fetch(url, { method: 'POST', credentials: 'same-origin', headers, body: form }));
}

export interface Participant {
  id: number;
  email: string | null;
  name: string | null;
  gender: string | null;
  study_level: string | null;
  consent_audio: boolean;
  consent_text: boolean;
  preferred_language: string | null;
  resume_code: string;
  profile_complete: boolean;
}

export interface AppConfig {
  google_client_id: string | null;
  dev_login: boolean;
  languages: Array<{ code: string; name: string; transliterate: boolean }>;
  model_hops_enabled: boolean;
  limits: { max_listens: number; max_takes: number; max_audio_seconds: number; text_read_seconds: number };
}

export type Modality = 'AUDIO' | 'TEXT';

export interface TaskView {
  id: number;
  modality: Modality;
  language: string;
  chain_code: string;
  hop_index: number;
  expires_at: string;
  status: string;
  content_fetches: number;
  reading_started_at: string | null;
  reading_hidden_at: string | null;
  reading_deadline: string | null;
  limits: { max_listens: number; max_takes: number; max_audio_seconds: number; text_read_seconds: number };
}

export interface MeResponse {
  participant: Participant;
  active_task: TaskView | null;
  progress: Record<Modality, 'DONE' | 'TODO'>;
  availability: Record<Modality, number>;
}
