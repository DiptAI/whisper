<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { put, type Participant } from '@/api';
import { session } from '@/session';

const router = useRouter();
const error = ref('');
const busy = ref(false);
const form = ref({
  name: '',
  gender: '',
  study_level: '',
  consent_audio: true,
  consent_text: true,
  preferred_language: 'en',
});

const GENDERS = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];
const STUDY_LEVELS = ['School', 'Undergraduate', 'Postgraduate', 'PhD / Research', 'Other'];

onMounted(async () => {
  await session.ensureLoaded();
  const p = session.participant.value;
  if (p) {
    form.value.name = p.name ?? '';
    form.value.gender = p.gender ?? '';
    form.value.study_level = p.study_level ?? '';
    form.value.preferred_language = p.preferred_language ?? 'en';
    if (p.profile_complete) {
      form.value.consent_audio = p.consent_audio;
      form.value.consent_text = p.consent_text;
    }
  }
});

async function save(): Promise<void> {
  error.value = '';
  busy.value = true;
  try {
    const r = await put<{ participant: Participant }>('/api/me/profile', form.value);
    session.setParticipant(r.participant);
    await router.replace('/');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="card">
    <h1>About you</h1>
    <p class="muted">Needed once. Your email is only used to let you resume; it is not shared.</p>
    <label>Name</label>
    <input v-model="form.name" type="text" />
    <div class="grid2">
      <div>
        <label>Gender</label>
        <select v-model="form.gender">
          <option value="" disabled>Select</option>
          <option v-for="g in GENDERS" :key="g" :value="g">{{ g }}</option>
        </select>
      </div>
      <div>
        <label>Study level</label>
        <select v-model="form.study_level">
          <option value="" disabled>Select</option>
          <option v-for="s in STUDY_LEVELS" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
    </div>
    <label>Preferred language</label>
    <select v-model="form.preferred_language">
      <option v-for="l in session.config.value?.languages ?? []" :key="l.code" :value="l.code">{{ l.name }}</option>
    </select>

    <h2 style="margin-top: 20px">Consent</h2>
    <p class="muted">
      Your recordings and typed text will be stored and used, anonymised, for language research and may be shown to other participants
      as part of the chain. You can stop at any time.
    </p>
    <label class="check"><input v-model="form.consent_audio" type="checkbox" /> I consent to my <b>voice recordings</b> being collected and used for research.</label>
    <label class="check"><input v-model="form.consent_text" type="checkbox" /> I consent to my <b>typed text</b> being collected and used for research.</label>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="row" style="margin-top: 12px">
      <button :disabled="busy || !form.name || !form.gender || !form.study_level || (!form.consent_audio && !form.consent_text)" @click="save">
        Continue
      </button>
    </div>
  </div>
</template>
