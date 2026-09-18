<script setup lang="ts">
/**
 * Records up to `maxTakes` takes of at most `maxSeconds` each via
 * MediaRecorder, converts each take to 16 kHz WAV, lets the participant
 * choose the take to submit.
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { blobToWav, formatSeconds } from '@/lib/wav';

const props = defineProps<{ maxTakes: number; maxSeconds: number; disabled?: boolean }>();
const emit = defineEmits<{ (e: 'select', payload: { wav: Blob; durationMs: number; takeIndex: number } | null): void }>();

interface Take {
  url: string;
  wav: Blob;
  durationMs: number;
}

const takes = ref<Take[]>([]);
const selected = ref<number | null>(null);
const recording = ref(false);
const elapsed = ref(0);
const error = ref('');
const converting = ref(false);
let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let timer: number | null = null;
let startedAt = 0;

const canRecord = computed(() => !props.disabled && !recording.value && !converting.value && takes.value.length < props.maxTakes);

async function start(): Promise<void> {
  error.value = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    error.value = 'Microphone access was denied. Please allow the microphone and try again.';
    return;
  }
  chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => void finishTake();
  recorder.start(250);
  recording.value = true;
  startedAt = Date.now();
  elapsed.value = 0;
  timer = window.setInterval(() => {
    elapsed.value = (Date.now() - startedAt) / 1000;
    if (elapsed.value >= props.maxSeconds) stop();
  }, 200);
}

function stop(): void {
  if (timer) window.clearInterval(timer);
  timer = null;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recording.value = false;
}

async function finishTake(): Promise<void> {
  converting.value = true;
  try {
    const raw = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
    const { wav, durationMs } = await blobToWav(raw);
    takes.value.push({ url: URL.createObjectURL(wav), wav, durationMs });
    select(takes.value.length - 1);
  } catch {
    error.value = 'Could not process the recording. Please try again.';
  } finally {
    converting.value = false;
  }
}

function select(i: number): void {
  selected.value = i;
  const t = takes.value[i];
  emit('select', { wav: t.wav, durationMs: t.durationMs, takeIndex: i });
}

onBeforeUnmount(() => {
  stop();
  takes.value.forEach((t) => URL.revokeObjectURL(t.url));
});
</script>

<template>
  <div>
    <div class="row" style="margin-bottom: 8px">
      <button v-if="!recording" class="big" :disabled="!canRecord" @click="start">
        🎙️ {{ takes.length === 0 ? 'Record' : 'Record another take' }} ({{ takes.length }}/{{ maxTakes }})
      </button>
      <button v-else class="big danger" @click="stop"><span class="rec-dot"></span> Stop</button>
      <span v-if="recording" class="timer">{{ formatSeconds(elapsed) }} / {{ formatSeconds(maxSeconds) }}</span>
      <span v-else-if="converting" class="muted">Processing…</span>
    </div>
    <div v-if="recording" class="meter"><div :style="{ width: `${(elapsed / maxSeconds) * 100}%` }"></div></div>
    <p v-if="error" class="error">{{ error }}</p>
    <div v-for="(t, i) in takes" :key="t.url" class="row" style="margin-top: 10px">
      <label class="check" style="margin: 0"><input type="radio" :checked="selected === i" @change="select(i)" /> Take {{ i + 1 }} · {{ formatSeconds(t.durationMs / 1000) }}</label>
      <audio :src="t.url" controls preload="metadata" style="height: 36px"></audio>
    </div>
  </div>
</template>
