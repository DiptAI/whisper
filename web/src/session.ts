import { ref } from 'vue';
import { get, type AppConfig, type MeResponse, type Participant } from './api';

const participant = ref<Participant | null>(null);
const config = ref<AppConfig | null>(null);
let loaded = false;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  await Promise.all([refreshMe(), loadConfig()]);
}

async function loadConfig(): Promise<AppConfig> {
  if (!config.value) config.value = await get<AppConfig>('/api/config');
  return config.value;
}

async function refreshMe(language?: string): Promise<MeResponse | null> {
  try {
    const me = await get<MeResponse>(`/api/me${language ? `?language=${language}` : ''}`);
    participant.value = me.participant;
    return me;
  } catch {
    participant.value = null;
    return null;
  }
}

function setParticipant(p: Participant | null): void {
  participant.value = p;
  loaded = true;
}

export const session = { participant, config, ensureLoaded, loadConfig, refreshMe, setParticipant };
