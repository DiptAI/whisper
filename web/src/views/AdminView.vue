<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ApiRequestError, get, post, postForm } from '@/api';
import { blobToWav } from '@/lib/wav';
import { session } from '@/session';

interface ChainSummary {
  id: number;
  code: string;
  modality: 'AUDIO' | 'TEXT';
  language: string;
  composition: string;
  max_hops: number;
  status: string;
  head_hop_index: number;
  human_hops: number;
  model_hops: number;
  active_assignment: boolean;
  pending_job: boolean;
}
interface Job {
  id: number;
  chain_id: number;
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
}
interface Overview {
  totals: { participants: number; chains: number; human_hops: number; model_hops: number };
  config: { max_hops: number; model_every_n: number; composition: Record<string, number>; audio_model_kind: string; providers: { gemini: boolean; groq: boolean } };
  chains: ChainSummary[];
  jobs: Job[];
}
interface Hop {
  id: number;
  hop_index: number;
  contributor_type: string;
  participant_id: number | null;
  model_name: string | null;
  text_content: string | null;
  audio_url: string | null;
  audio_duration_ms: number | null;
  listen_count: number | null;
  takes_count: number | null;
  read_seconds: number | null;
  metadata: Record<string, unknown>;
}

const token = ref(localStorage.getItem('wc_admin_token') ?? '');
const authed = ref(false);
const error = ref('');
const overview = ref<Overview | null>(null);
const detail = ref<{ chain: ChainSummary; hops: Hop[] } | null>(null);
const seed = ref({ modality: 'TEXT' as 'TEXT' | 'AUDIO', language: 'en', composition: '', text: '', title: '' });
const seedFile = ref<File | null>(null);
const seedBusy = ref(false);
const seedMsg = ref('');
const filterModality = ref('');
const filterLanguage = ref('');

const headers = computed(() => ({ 'x-admin-token': token.value }));
const languages = computed(() => session.config.value?.languages ?? []);
const filtered = computed(() =>
  (overview.value?.chains ?? []).filter((c) => (!filterModality.value || c.modality === filterModality.value) && (!filterLanguage.value || c.language === filterLanguage.value)),
);

async function load(): Promise<void> {
  error.value = '';
  try {
    overview.value = await get<Overview>(`/api/admin/overview?token=${encodeURIComponent(token.value)}`);
    authed.value = true;
    localStorage.setItem('wc_admin_token', token.value);
  } catch (e) {
    authed.value = false;
    error.value = e instanceof ApiRequestError ? e.message : (e as Error).message;
  }
}

async function openChain(id: number): Promise<void> {
  detail.value = await get(`/api/admin/chains/${id}?token=${encodeURIComponent(token.value)}`);
}

async function createSeed(): Promise<void> {
  seedMsg.value = '';
  seedBusy.value = true;
  try {
    const form = new FormData();
    form.append('modality', seed.value.modality);
    form.append('language', seed.value.language);
    if (seed.value.composition) form.append('composition', seed.value.composition);
    if (seed.value.title) form.append('title', seed.value.title);
    if (seed.value.modality === 'TEXT') form.append('text', seed.value.text);
    else {
      if (!seedFile.value) throw new Error('Choose an audio file');
      const { wav } = await blobToWav(seedFile.value);
      form.append('audio', wav, 'seed.wav');
    }
    const r = await postForm<{ chain: { code: string } }>('/api/admin/seeds', form, headers.value);
    seedMsg.value = `Created ${r.chain.code}`;
    seed.value.text = '';
    seed.value.title = '';
    seedFile.value = null;
    await load();
  } catch (e) {
    seedMsg.value = e instanceof ApiRequestError ? e.message : (e as Error).message;
  } finally {
    seedBusy.value = false;
  }
}

async function retry(id: number): Promise<void> {
  await post(`/api/admin/jobs/${id}/retry`, undefined, headers.value);
  await load();
}

function transcriptOf(h: Hop): string | null {
  const t = (h.metadata as { transcript?: unknown }).transcript;
  return typeof t === 'string' && t ? t : null;
}

function audioSrc(url: string): string {
  return `${url}?token=${encodeURIComponent(token.value)}`;
}

onMounted(async () => {
  await session.loadConfig();
  if (token.value) await load();
});
</script>

<template>
  <div v-if="!authed" class="card">
    <h1>Admin</h1>
    <label>Admin token</label>
    <input v-model="token" type="text" @keyup.enter="load" />
    <div class="row" style="margin-top: 12px"><button @click="load">Open</button></div>
    <p v-if="error" class="error">{{ error }}</p>
  </div>

  <div v-else-if="overview">
    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h1 style="margin: 0">Admin dashboard</h1>
        <div class="row">
          <a :href="`/api/admin/export.json?token=${encodeURIComponent(token)}`" target="_blank">export.json</a>
          <a :href="`/api/admin/export.zip?token=${encodeURIComponent(token)}`">export.zip (with audio)</a>
          <button class="secondary" @click="load">Refresh</button>
        </div>
      </div>
      <p class="muted" style="margin-top: 8px">
        {{ overview.totals.participants }} participants · {{ overview.totals.chains }} chains · {{ overview.totals.human_hops }} human hops ·
        {{ overview.totals.model_hops }} model hops · max {{ overview.config.max_hops }} hops · model every {{ overview.config.model_every_n }}th hop in MIXED ·
        providers: gemini={{ overview.config.providers.gemini }}, groq={{ overview.config.providers.groq }}
      </p>
    </div>

    <div class="card">
      <h2>Add seed</h2>
      <div class="grid2">
        <div>
          <label>Modality</label>
          <select v-model="seed.modality"><option value="TEXT">TEXT</option><option value="AUDIO">AUDIO</option></select>
        </div>
        <div>
          <label>Language</label>
          <select v-model="seed.language"><option v-for="l in languages" :key="l.code" :value="l.code">{{ l.name }}</option></select>
        </div>
        <div>
          <label>Composition</label>
          <select v-model="seed.composition">
            <option value="">random (by configured proportions)</option>
            <option value="ALL_HUMAN">ALL_HUMAN</option>
            <option value="ALL_MODEL">ALL_MODEL</option>
            <option value="MIXED">MIXED</option>
          </select>
        </div>
        <div>
          <label>Title (optional)</label>
          <input v-model="seed.title" type="text" />
        </div>
      </div>
      <template v-if="seed.modality === 'TEXT'">
        <label>Passage</label>
        <textarea v-model="seed.text" :lang="seed.language"></textarea>
      </template>
      <template v-else>
        <label>Audio file (any format, converted to 16 kHz WAV in the browser; keep it under 60 s)</label>
        <input type="file" accept="audio/*" @change="seedFile = ($event.target as HTMLInputElement).files?.[0] ?? null" />
      </template>
      <div class="row" style="margin-top: 12px">
        <button :disabled="seedBusy" @click="createSeed">Create seed</button>
        <span :class="seedMsg.startsWith('Created') ? 'ok' : 'error'">{{ seedMsg }}</span>
      </div>
    </div>

    <div class="card" v-if="overview.jobs.length">
      <h2>Model jobs (open / failed)</h2>
      <table>
        <tr><th>id</th><th>chain</th><th>kind</th><th>status</th><th>attempts</th><th>error</th><th></th></tr>
        <tr v-for="j in overview.jobs" :key="j.id">
          <td>{{ j.id }}</td><td>{{ j.chain_id }}</td><td>{{ j.kind }}</td><td>{{ j.status }}</td><td>{{ j.attempts }}</td>
          <td class="muted" style="max-width: 320px; word-break: break-word">{{ j.last_error }}</td>
          <td><button v-if="j.status === 'FAILED'" class="secondary" @click="retry(j.id)">Retry</button></td>
        </tr>
      </table>
    </div>

    <div class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">Chains</h2>
        <div class="row">
          <select v-model="filterModality"><option value="">all modalities</option><option value="AUDIO">AUDIO</option><option value="TEXT">TEXT</option></select>
          <select v-model="filterLanguage"><option value="">all languages</option><option v-for="l in languages" :key="l.code" :value="l.code">{{ l.name }}</option></select>
        </div>
      </div>
      <table style="margin-top: 12px">
        <tr><th>code</th><th>composition</th><th>head</th><th>human</th><th>model</th><th>status</th><th>state</th></tr>
        <tr v-for="c in filtered" :key="c.id">
          <td><a href="#" @click.prevent="openChain(c.id)">{{ c.code }}</a></td>
          <td>{{ c.composition }}</td>
          <td>{{ c.head_hop_index }} / {{ c.max_hops }}</td>
          <td>{{ c.human_hops }}</td>
          <td>{{ c.model_hops }}</td>
          <td>{{ c.status }}</td>
          <td class="muted">{{ c.active_assignment ? 'leased' : c.pending_job ? 'model running' : c.status === 'OPEN' ? 'in pool' : '' }}</td>
        </tr>
      </table>
      <p v-if="!filtered.length" class="muted">No chains yet. Add seeds above or run <code>pnpm seed:import</code>.</p>
    </div>

    <div class="card" v-if="detail">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">{{ detail.chain.code }} · {{ detail.chain.composition }}</h2>
        <button class="secondary" @click="detail = null">Close</button>
      </div>
      <div v-for="h in detail.hops" :key="h.id" style="margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--border)">
        <div class="row">
          <b>Hop {{ h.hop_index }}</b>
          <span class="pill">{{ h.contributor_type }}</span>
          <span v-if="h.participant_id" class="muted">participant #{{ h.participant_id }}</span>
          <span v-if="h.model_name" class="muted">{{ h.model_name }}</span>
          <span v-if="h.listen_count !== null" class="muted">listens {{ h.listen_count }} · takes {{ h.takes_count }}</span>
          <span v-if="h.read_seconds !== null" class="muted">read {{ h.read_seconds }}s</span>
        </div>
        <audio v-if="h.audio_url" :src="audioSrc(h.audio_url)" controls preload="none" style="height: 36px; margin-top: 6px"></audio>
        <p v-if="h.text_content" class="passage" :lang="detail.chain.language" style="font-size: 1rem; margin-top: 6px">{{ h.text_content }}</p>
        <p v-if="transcriptOf(h)" class="muted" style="font-size: 0.85rem">Whisper transcript: {{ transcriptOf(h) }}</p>
      </div>
    </div>
  </div>
</template>
