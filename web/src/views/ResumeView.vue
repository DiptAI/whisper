<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { post, type Participant } from '@/api';
import { session } from '@/session';

const route = useRoute();
const router = useRouter();
const error = ref('');

onMounted(async () => {
  try {
    const r = await post<{ participant: Participant }>('/api/auth/resume', { code: String(route.params.code) });
    session.setParticipant(r.participant);
    await router.replace('/');
  } catch (e) {
    error.value = (e as Error).message;
  }
});
</script>

<template>
  <div class="card">
    <h1>Resuming…</h1>
    <p v-if="error" class="error">{{ error }} <RouterLink to="/login">Go to sign in</RouterLink></p>
  </div>
</template>
