export type Modality = 'AUDIO' | 'TEXT';
export type Composition = 'ALL_HUMAN' | 'ALL_MODEL' | 'MIXED';
export type ContributorType = 'SEED' | 'HUMAN' | 'MODEL';
export type AssignmentStatus = 'ACTIVE' | 'SUBMITTED' | 'EXPIRED' | 'ABANDONED';
export type ChainStatus = 'OPEN' | 'COMPLETE';
export type JobKind = 'LLM_TEXT' | 'ALM_AUDIO' | 'WHISPER_AUDIO';
export type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export interface Participant {
  id: number;
  google_sub: string | null;
  email: string | null;
  name: string | null;
  gender: string | null;
  study_level: string | null;
  consent_audio: boolean;
  consent_text: boolean;
  consented_at: Date | null;
  resume_code: string;
  preferred_language: string | null;
  created_at: Date;
  last_seen_at: Date;
}

export interface Chain {
  id: number;
  code: string;
  modality: Modality;
  language: string;
  composition: Composition;
  max_hops: number;
  status: ChainStatus;
  created_at: Date;
}

export interface Hop {
  id: number;
  chain_id: number;
  hop_index: number;
  parent_hop_id: number | null;
  contributor_type: ContributorType;
  participant_id: number | null;
  model_name: string | null;
  text_content: string | null;
  audio_blob_id: number | null;
  audio_mime: string | null;
  audio_duration_ms: number | null;
  listen_count: number | null;
  takes_count: number | null;
  read_seconds: number | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface Assignment {
  id: number;
  participant_id: number;
  chain_id: number;
  source_hop_id: number;
  modality: Modality;
  status: AssignmentStatus;
  expires_at: Date;
  content_fetches: number;
  reading_started_at: Date | null;
  reading_hidden_at: Date | null;
  submitted_hop_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ModelJob {
  id: number;
  chain_id: number;
  parent_hop_id: number;
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'ERROR',
  ) {
    super(message);
  }
}
