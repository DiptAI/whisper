<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { post } from './api';
import { session } from './session';

const route = useRoute();
const router = useRouter();

async function logout(): Promise<void> {
  await post('/api/auth/logout');
  session.setParticipant(null);
  await router.push({ name: 'login' });
}
</script>

<template>
  <div class="container">
    <header class="topbar">
      <RouterLink class="brand" to="/">Whisper Chain</RouterLink>
      <div v-if="session.participant.value && route.name !== 'admin'" class="row">
        <span class="muted">{{ session.participant.value.name || session.participant.value.email }}</span>
        <button class="secondary" @click="logout">Sign out</button>
      </div>
    </header>
    <RouterView />
  </div>
</template>
