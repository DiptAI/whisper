<script setup lang="ts">
/**
 * Textarea with Latin -> target-script transliteration. Type a word in
 * English letters, press space, and it is replaced by the top suggestion
 * (other candidates are shown as chips). Toggle off to type natively.
 */
import { computed, ref, watch } from 'vue';
import { post } from '@/api';
import { session } from '@/session';

const props = defineProps<{ modelValue: string; language: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();

const supported = computed(() => session.config.value?.languages.find((l) => l.code === props.language)?.transliterate ?? false);
const enabled = ref(true);
const candidates = ref<string[]>([]);
const lastWordRange = ref<{ start: number; end: number } | null>(null);
const el = ref<HTMLTextAreaElement | null>(null);
const busy = ref(false);

watch(
  () => props.language,
  () => {
    candidates.value = [];
  },
);

function setValue(v: string): void {
  emit('update:modelValue', v);
}

async function onKeydown(e: KeyboardEvent): Promise<void> {
  if (!supported.value || !enabled.value || e.key !== ' ' || !el.value) return;
  const ta = el.value;
  const pos = ta.selectionStart;
  const before = props.modelValue.slice(0, pos);
  const m = /([A-Za-z]+)$/.exec(before);
  if (!m) return;
  e.preventDefault();
  const word = m[1];
  const start = pos - word.length;
  busy.value = true;
  try {
    const r = await post<{ candidates: string[] }>('/api/transliterate', { text: word, language: props.language });
    const top = r.candidates[0] ?? word;
    const after = props.modelValue.slice(pos);
    const next = `${before.slice(0, start)}${top} ${after}`;
    setValue(next);
    lastWordRange.value = { start, end: start + top.length };
    candidates.value = r.candidates.slice(0, 5);
    await nextTickCaret(start + top.length + 1);
  } catch {
    setValue(`${before} ${props.modelValue.slice(pos)}`);
    await nextTickCaret(pos + 1);
  } finally {
    busy.value = false;
  }
}

async function nextTickCaret(pos: number): Promise<void> {
  await Promise.resolve();
  requestAnimationFrame(() => {
    if (!el.value) return;
    el.value.focus();
    el.value.setSelectionRange(pos, pos);
  });
}

async function pick(c: string): Promise<void> {
  const r = lastWordRange.value;
  if (!r) return;
  const next = `${props.modelValue.slice(0, r.start)}${c}${props.modelValue.slice(r.end)}`;
  setValue(next);
  lastWordRange.value = { start: r.start, end: r.start + c.length };
  await nextTickCaret(r.start + c.length + 1);
}
</script>

<template>
  <div>
    <div v-if="supported" class="row" style="justify-content: space-between; margin-bottom: 6px">
      <label class="check" style="margin: 0"><input v-model="enabled" type="checkbox" /> Transliterate from English keyboard (type <i>amar</i> + space)</label>
    </div>
    <textarea
      ref="el"
      :value="modelValue"
      :lang="language"
      spellcheck="false"
      autocomplete="off"
      @input="setValue(($event.target as HTMLTextAreaElement).value)"
      @keydown="onKeydown"
    ></textarea>
    <div v-if="supported && enabled && candidates.length > 1" class="suggest">
      <span class="muted" style="font-size: 0.85rem">Did you mean:</span>
      <button v-for="c in candidates" :key="c" type="button" @click="pick(c)">{{ c }}</button>
    </div>
  </div>
</template>
