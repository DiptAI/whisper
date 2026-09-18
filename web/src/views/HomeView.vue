<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError, get, post, type MeResponse, type Modality, type TaskView } from '@/api';
import { session } from '@/session';

const router = useRouter();
const me = ref<MeResponse | null>(null);
const language = ref('en');
const error = ref('');
const busy = ref(false);
const resumeInfo = ref<{ code: string; url: string; qr: string } | null>(null);
const showQr = ref(false);

const languages = computed(() => session.config.value?.languages ?? []);
const p = computed(() => session.participant.value);

async function load(): Promise<void> {
  me.value = await session.refreshMe(language.value);
}

onMounted(async () => {
  await session.ensureLoaded();
  language.value = session.participant.value?.preferred_language ?? 'en';
  await load();
});
watch(language, load);

function goToTask(t: TaskView): void {
  void router.push({ name: t.modality === 'AUDIO' ? 'audio-task' : 'text-task', params: { id: t.id } });
}

async function start(modality: Modality): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    const r = await post<{ task: TaskView }>('/api/tasks/start', { modality, language: language.value });
    goToTask(r.task);
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

async function toggleQr(): Promise<void> {
  if (!resumeInfo.value) resumeInfo.value = await get('/api/me/resume-code');
  showQr.value = !showQr.value;
}
</script>

<template>
  <div v-if="me && p">
    <div class="card" v-if="me.active_task">
      <h2>You have a task in progress</h2>
      <p class="muted">{{ me.active_task.modality === 'AUDIO' ? 'Audio' : 'Text' }} task, {{ me.active_task.chain_code }}</p>
      <button @click="goToTask(me.active_task)">Continue</button>
    </div>

    <div class="card">
      <h1>Choose a task</h1>
      <p class="muted">Each participant does one audio task and one text task. Pick a language first.</p>
      <label>Language</label>
      <select v-model="language">
        <option v-for="l in languages" :key="l.code" :value="l.code">{{ l.name }}</option>
      </select>

      <div class="grid2" style="margin-top: 16px">
        <div class="card" style="margin: 0">
          <h2>🎧 Audio <span class="pill" :class="{ done: me.progress.AUDIO === 'DONE' }">{{ me.progress.AUDIO === 'DONE' ? 'done' : 'to do' }}</span></h2>
          <p class="muted">Listen to a recording (up to {{ session.config.value?.limits.max_listens }} times), then record what you remember in up to {{ session.config.value?.limits.max_takes }} takes, 1 minute max.</p>
          <p v-if="!p.consent_audio" class="muted">You did not consent to audio collection.</p>
          <p v-else-if="me.progress.AUDIO === 'DONE'" class="ok">Thank you, completed.</p>
          <p v-else-if="me.availability.AUDIO === 0 && !me.active_task" class="muted">Nothing available in this language right now.</p>
          <button
            v-else
            :disabled="busy || Boolean(me.active_task)"
            @click="start('AUDIO')"
          >
            Start audio task
          </button>
        </div>
        <div class="card" style="margin: 0">
          <h2>📖 Text <span class="pill" :class="{ done: me.progress.TEXT === 'DONE' }">{{ me.progress.TEXT === 'DONE' ? 'done' : 'to do' }}</span></h2>
          <p class="muted">Read a passage for up to {{ Math.round((session.config.value?.limits.text_read_seconds ?? 300) / 60) }} minutes, then write down what you remember.</p>
          <p v-if="!p.consent_text" class="muted">You did not consent to text collection.</p>
          <p v-else-if="me.progress.TEXT === 'DONE'" class="ok">Thank you, completed.</p>
          <p v-else-if="me.availability.TEXT === 0 && !me.active_task" class="muted">Nothing available in this language right now.</p>
          <button v-else :disabled="busy || Boolean(me.active_task)" @click="start('TEXT')">Start text task</button>
        </div>
      </div>
      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <div class="card">
      <h2>Your resume code</h2>
      <p class="muted">Use this code (or scan the QR) to come back later and continue where you left off.</p>
      <div class="code">{{ p.resume_code }}</div>
      <div class="row" style="justify-content: center; margin-top: 8px">
        <button class="secondary" @click="toggleQr">{{ showQr ? 'Hide QR' : 'Show QR' }}</button>
      </div>
      <div v-if="showQr && resumeInfo" style="text-align: center">
        <img class="qr" :src="resumeInfo.qr" alt="Resume QR code" />
        <p class="muted" style="font-size: 0.85rem">{{ resumeInfo.url }}</p>
      </div>
    </div>
  </div>
  <div v-else class="card"><p class="muted">Loading…</p></div>
</template>
