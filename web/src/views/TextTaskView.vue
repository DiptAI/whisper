<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiRequestError, get, post, type TaskView } from '@/api';
import TranslitTextarea from '@/components/TranslitTextarea.vue';
import { formatSeconds } from '@/lib/wav';
import { session } from '@/session';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);
const task = ref<TaskView | null>(null);
const error = ref('');
const text = ref('');
const deadline = ref<number | null>(null);
const now = ref(Date.now());
const phase = ref<'read' | 'write'>('read');
const answer = ref('');
const submitting = ref(false);
const done = ref(false);
let timer: number | null = null;

const secondsLeft = computed(() => (deadline.value ? Math.max(0, Math.ceil((deadline.value - now.value) / 1000)) : 0));

onMounted(async () => {
  try {
    const r = await get<{ task: TaskView }>(`/api/tasks/${id}`);
    task.value = r.task;
    if (r.task.status !== 'ACTIVE') {
      error.value = 'This task is no longer active.';
      return;
    }
    if (r.task.reading_hidden_at) {
      phase.value = 'write';
      return;
    }
    const t = await get<{ text: string; reading_deadline: string }>(`/api/tasks/${id}/text`);
    text.value = t.text;
    deadline.value = new Date(t.reading_deadline).getTime();
    timer = window.setInterval(() => {
      now.value = Date.now();
      if (deadline.value && now.value >= deadline.value) void hide();
    }, 500);
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'TEXT_HIDDEN') phase.value = 'write';
    else error.value = e instanceof ApiRequestError ? e.message : (e as Error).message;
  }
});

onBeforeUnmount(() => {
  if (timer) window.clearInterval(timer);
});

async function hide(): Promise<void> {
  if (phase.value === 'write') return;
  phase.value = 'write';
  text.value = '';
  if (timer) window.clearInterval(timer);
  try {
    await post(`/api/tasks/${id}/hide`);
  } catch {
    /* server also enforces the deadline */
  }
}

async function submit(): Promise<void> {
  error.value = '';
  submitting.value = true;
  try {
    await post(`/api/tasks/${id}/submit-text`, { text: answer.value });
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
    <p>Your text has been added to the chain and will be passed to the next participant.</p>
    <RouterLink to="/"><button>Back to home</button></RouterLink>
  </div>

  <div v-else-if="task">
    <div class="card">
      <h1>Text task <span class="pill">{{ task.chain_code }} · hop {{ task.hop_index }}</span></h1>
      <p class="muted">
        Read the passage below. You have up to <b>{{ formatSeconds(task.limits.text_read_seconds) }}</b> minutes. When time is up (or you
        press "I'm done reading") the passage disappears and you write down whatever you remember, in the same language.
      </p>
    </div>

    <div v-if="phase === 'read'" class="card">
      <div class="row" style="justify-content: space-between">
        <h2 style="margin: 0">Step 1 · Read</h2>
        <span class="timer">{{ formatSeconds(secondsLeft) }}</span>
      </div>
      <div class="passage" :lang="task.language" style="margin-top: 12px">{{ text }}</div>
      <div class="row" style="margin-top: 16px">
        <button class="big" @click="hide">I'm done reading</button>
      </div>
    </div>

    <div v-else class="card">
      <h2>Step 2 · Write what you remember</h2>
      <TranslitTextarea v-model="answer" :language="task.language" />
      <div class="row" style="margin-top: 16px">
        <button class="big" :disabled="!answer.trim() || submitting" @click="submit">{{ submitting ? 'Submitting…' : 'Submit' }}</button>
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
