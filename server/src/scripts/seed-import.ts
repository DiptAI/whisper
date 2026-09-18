/**
 * Bulk seed import.
 *
 *   pnpm seed:import <folder> [--base http://localhost:3000] [--token ADMIN_TOKEN]
 *
 * Folder layout:
 *   <folder>/text/<lang>/*.txt          one paragraph per file
 *   <folder>/audio/<lang>/*.wav|*.mp3   one recording (<= 60 s) per file
 *   optional <folder>/composition.json  { "TXT-BN-001": "ALL_HUMAN", ... } (else random by env proportions)
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const folder = args.find((a) => !a.startsWith('--'));
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://localhost:3000';
const token = args.includes('--token') ? args[args.indexOf('--token') + 1] : process.env.ADMIN_TOKEN ?? 'admin';
if (!folder) {
  console.error('usage: seed-import <folder> [--base URL] [--token ADMIN_TOKEN]');
  process.exit(1);
}

async function post(form: FormData): Promise<void> {
  const res = await fetch(`${base}/api/admin/seeds`, { method: 'POST', headers: { 'x-admin-token': token }, body: form });
  const json = (await res.json()) as { chain?: { code: string }; error?: { message: string } };
  if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  console.log('created', json.chain?.code);
}

async function main(): Promise<void> {
  for (const modality of ['TEXT', 'AUDIO'] as const) {
    const dir = path.join(folder!, modality === 'TEXT' ? 'text' : 'audio');
    if (!fs.existsSync(dir)) continue;
    for (const lang of fs.readdirSync(dir)) {
      const langDir = path.join(dir, lang);
      if (!fs.statSync(langDir).isDirectory()) continue;
      for (const file of fs.readdirSync(langDir).sort()) {
        const full = path.join(langDir, file);
        const form = new FormData();
        form.append('modality', modality);
        form.append('language', lang);
        form.append('title', path.parse(file).name);
        if (modality === 'TEXT') {
          form.append('text', fs.readFileSync(full, 'utf8'));
        } else {
          const mime = file.endsWith('.mp3') ? 'audio/mpeg' : file.endsWith('.ogg') ? 'audio/ogg' : 'audio/wav';
          form.append('audio', new Blob([new Uint8Array(fs.readFileSync(full))], { type: mime }), file);
        }
        await post(form);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
