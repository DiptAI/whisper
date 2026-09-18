<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiRequestError, get, post, postForm, type TaskView } from '@/api';
import AudioRecorder from '@/components/AudioRecorder.vue';
import { session } from '@/session';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);
const task = ref<TaskView | null>(null);
const error = ref('');
const audioUrl = ref<string | null>(null);
const player = ref<HTMLAudioElement | null>(null);
const listens = ref(0);
const playing = ref(false);
const selection = ref<{ wav: Blob; durationMs: number; takeIndex: number } | null>(null);
const takesMade = ref(0);
const submitting = ref(false);
const done = ref(false);
const phase = ref<'listen' | 'record'>('listen');

const maxListens = computed(() => task.value?.limits.max_listens ?? 3);
const listensLeft = computed(() => Math.max(0, maxListens.value - listens.value));

onMounted(async () => {
  try {
    const r = await get<{ task: TaskView }>(`/api/tasks/${id}`);
    task.value = r.task;
    if (r.task.status !== 'ACTIVE') {
      error.value = 'This task is no longer active.';
      return;
    }
    // One network fetch; playback count is enforced client-side (server caps fetches too).
    const res = await fetch(`/api/tasks/${id}/audio`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Could not load the recording');
    audioUrl.value = URL.createObjectURL(await res.blob());
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : (e as Error).message;
  }
});

onBeforeUnmount(() => {
  if (audioUrl.value) URL.revokeObjectURL(audioUrl.value);
});

function play(): void {
  if (!player.value || listensLeft.value === 0 || playing.value) return;
  listens.value += 1;
  playing.value = true;
  player.value.currentTime = 0;
  void player.value.play();
}

function onEnded(): void {
  playing.value = false;
}

function onSelect(sel: { wav: Blob; durationMs: number; takeIndex: number } | null): void {
  selection.value = sel;
  if (sel) takesMade.value = Math.max(takesMade.value, sel.takeIndex + 1);
}

async function submit(): Promise<void> {
  if (!selection.value) return;
  error.value = '';
  submitting.value = true;
  try {
    const form = new FormData();
    form.append('audio', selection.value.wav, 'take.wav');
    form.append('listen_count', String(listens.value));
    form.append('takes_count', String(takesMade.value));
    form.append('duration_ms', String(selection.value.durationMs));
    await postForm(`/api/tasks/${id}/submit-audio`, form);
    done.value = true;
    await session.refreshMe();
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : (e as Error).message;
  } finally {
    submitting.value = false;
  }
}

async function abandon(): Promise<void> {
  if (!confirm('Give up this task? It will be handed to someone else.')) return;
  await post(`/api/tasks/${id}/abandon`);
  await router.replace('/');
}
</script>

<template>
  <div v-if="done" class="card">
    <h1>Thank you! 🎉</h1>
    <p>Your recording has been added to the chain and will be passed to the next participant.</p>
    <RouterLink to="/"><button>Back to home</button></RouterLink>
  </div>

  <div v-else-if="task">
    <div class="card">
      <h1>Audio task <span class="pill">{{ task.chain_code }} · hop {{ task.hop_index }}</span></h1>
      <p class="muted">
        1. Listen to the recording carefully. You may play it up to <b>{{ maxListens }}</b> times.<br />
        2. Then record yourself saying what you remember, in the same language, in up to <b>{{ task.limits.max_takes }}</b> takes of at most
        <b>{{ task.limits.max_audio_seconds }}</b> seconds.
      </p>
    </div>

    <div class="card">
      <h2>Step 1 · Listen <span class="pill">{{ listensLeft }} of {{ maxListens }} plays left</span></h2>
      <audio ref="player" :src="audioUrl ?? undefined" preload="auto" @ended="onEnded" @pause="onEnded"></audio>
      <div class="row">
        <button class="big" :disabled="!audioUrl || listensLeft === 0 || playing || phase === 'record'" @click="play">
          {{ playing ? '▶ Playing…' : '▶ Play' }}
        </button>
        <button v-if="phase === 'listen'" class="secondary" :disabled="listens === 0 || playing" @click="phase = 'record'">I'm ready to record</button>
      </div>
      <p v-if="phase === 'listen' && listens === 0" class="muted" style="margin-top: 8px">Play the recording at least once before recording.</p>
      <p v-if="phase === 'record'" class="muted" style="margin-top: 8px">Listening is now closed.</p>
    </div>

    <div class="card" v-if="phase === 'record'">
      <h2>Step 2 · Record what you remember</h2>
      <AudioRecorder :max-takes="task.limits.max_takes" :max-seconds="task.limits.max_audio_seconds" :disabled="submitting" @select="onSelect" />
      <div class="row" style="margin-top: 16px">
        <button class="big" :disabled="!selection || submitting" @click="submit">{{ submitting ? 'Submitting…' : 'Submit selected take' }}</button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div class="row"><button class="secondary" @click="abandon">Give up this task</button></div>
  </div>

  <div v-else class="card">
    <p v-if="error" class="error">{{ error }} <RouterLink to="/">Back</RouterLink></p>
    <p v-else class="muted">Loading…</p>
  </div>
</template>
