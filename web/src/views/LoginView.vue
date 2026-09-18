<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { post, type Participant } from '@/api';
import { session } from '@/session';

const route = useRoute();
const router = useRouter();
const error = ref('');
const email = ref('');
const name = ref('');
const code = ref('');
const googleEl = ref<HTMLElement | null>(null);
const busy = ref(false);

function next(): void {
  const target = typeof route.query.next === 'string' ? route.query.next : '/';
  void router.replace(target);
}

async function finish(p: Participant): Promise<void> {
  session.setParticipant(p);
  next();
}

async function devLogin(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    const r = await post<{ participant: Participant }>('/api/auth/dev', { email: email.value, name: name.value || undefined });
    await finish(r.participant);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function resume(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    const r = await post<{ participant: Participant }>('/api/auth/resume', { code: code.value });
    await finish(r.participant);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await session.ensureLoaded();
  if (session.participant.value) return next();
  const cfg = session.config.value;
  if (cfg?.google_client_id && googleEl.value) {
    const tryInit = (): void => {
      if (!window.google) return void setTimeout(tryInit, 200);
      window.google.accounts.id.initialize({
        client_id: cfg.google_client_id!,
        callback: async (r) => {
          try {
            const res = await post<{ participant: Participant }>('/api/auth/google', { credential: r.credential });
            await finish(res.participant);
          } catch (e) {
            error.value = (e as Error).message;
          }
        },
      });
      window.google.accounts.id.renderButton(googleEl.value!, { theme: 'outline', size: 'large', width: 280 });
    };
    tryInit();
  }
});
</script>

<template>
  <div class="card">
    <h1>Audio / Text data collection</h1>
    <p class="muted">
      You will listen to a short recording or read a short passage, and then reproduce it from memory. Your contribution is passed on to the
      next participant, like a game of Chinese whispers.
    </p>
  </div>

  <div class="card" v-if="session.config.value?.google_client_id">
    <h2>Sign in</h2>
    <div ref="googleEl"></div>
  </div>

  <div class="card" v-else-if="session.config.value?.dev_login">
    <h2>Sign in (local testing)</h2>
    <label>Email</label>
    <input v-model="email" type="email" placeholder="you@example.com" />
    <label>Name</label>
    <input v-model="name" type="text" placeholder="optional" />
    <div class="row" style="margin-top: 12px">
      <button :disabled="busy || !email" @click="devLogin">Continue</button>
    </div>
  </div>

  <div class="card">
    <h2>Returning? Enter your resume code</h2>
    <p class="muted">The code was shown on your home screen (also as a QR code).</p>
    <input v-model="code" type="text" placeholder="ABCD-EFGH" maxlength="9" style="text-transform: uppercase" />
    <div class="row" style="margin-top: 12px">
      <button class="secondary" :disabled="busy || code.length < 8" @click="resume">Resume</button>
    </div>
  </div>
  <p v-if="error" class="error">{{ error }}</p>
</template>
