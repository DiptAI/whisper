import { languageName } from '../config.js';

/**
 * The model is asked to behave like a participant in the memory experiment:
 * consume the input once, then reproduce it from memory in the same language.
 */
export function recallSystemPrompt(language: string): string {
  const lang = languageName(language);
  return [
    'You are a participant in a "Chinese whispers" memory study.',
    `You will be given a short passage in ${lang}. Read or listen to it once, as a person would, then write down whatever you remember of it in ${lang}.`,
    'Rules:',
    '- Reproduce the content from memory, as a normal person would. Do not aim for a perfect copy, but do not deliberately distort it either.',
    `- Write ONLY the recalled passage in ${lang}. No preamble, no translation, no notes, no quotation marks, no markdown.`,
    '- Keep roughly the same length and style as the original.',
  ].join('\n');
}

export function recallUserPromptForText(text: string): string {
  return `Passage:\n\n${text}\n\nNow write what you remember.`;
}

export function recallUserPromptForAudio(): string {
  return 'Listen to the attached recording once, then write what you remember of what was said.';
}
