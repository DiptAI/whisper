# Whisper Chain — audio / text data collection tool

A small web app for collecting "Chinese whispers" style data: a participant hears a recording (or reads a
passage), then reproduces it from memory. Their output becomes the input for the next participant. Chains
can be all-human, all-model (LLM / audio-language-model), or a mix, so the resulting dataset lets you compare
how humans and models drift over hops.

Built from the hand-written spec in `New Note 2026-09-10`. Stack: Node 20+, TypeScript, Express, Knex,
PostgreSQL, Vue 3 + Vite. Deployable to Railway in a few minutes.

---

## 1. What a participant sees

1. **Sign in** with Google (or email-only "dev login" when Google is not configured).
2. **Profile & consent** (once): name, gender, study level, consent for audio, consent for text, preferred language.
3. **Home**: choose language (English default + Bengali, Hindi, Tamil, Telugu, Marathi, Kannada, Malayalam,
   Gujarati, Punjabi, Odia, Assamese, Urdu), then pick **Audio** or **Text**. A personal **resume code + QR**
   is shown so they can come back later (`/r/<code>`).
4. **Audio task**: play the recording (≤ 1 min) up to **3 times** → record up to **3 takes** of ≤ 60 s →
   submit one. Recordings are converted to 16 kHz mono WAV in the browser.
5. **Text task**: read the passage for up to **5 minutes** (countdown; "I'm done reading" ends it early) →
   passage disappears → type what you remember. A **transliteration keyboard** (English letters → selected
   script, via Google Input Tools, free) is on by default for Indic languages.
6. Each participant does **at most one audio task and one text task**.

Limits above are env-configurable (`MAX_AUDIO_LISTENS`, `MAX_AUDIO_TAKES`, `MAX_AUDIO_SECONDS`, `TEXT_READ_SECONDS`).

## 2. How chains grow (the "probabilistic hop")

* Admins upload **seeds** (target: 50 audio + 50 text), coded `AUD-BN-001`, `TXT-HI-002`, … Each seed is
  hop 0 of a chain.
* Every chain has a **composition**: `ALL_HUMAN`, `ALL_MODEL` or `MIXED`. Chosen explicitly at upload or
  randomly using `COMPOSITION_*` proportions.
* Chains grow to `MAX_HOPS` (default 6) hops after the seed, then close.
* In `MIXED` chains a model produces **every Nth hop** (`MODEL_EVERY_N`, default 3 → hops 3 and 6). This is the
  "automatically at a fixed rate" rule. `ALL_MODEL` chains are run end-to-end by the worker.
* When a participant starts a task in language L / modality M, the server builds the candidate set of chain
  heads that are: same L and M, still open, not leased by someone else, not waiting on a model hop, whose
  next hop is a human hop, and **that this participant has never touched** (contributed to or been assigned;
  the note's "U1 did A00 → never gets A12…A15" rule).
* One head is picked **at random, weighted by `1 + depth`** so that deeper chains are slightly preferred and
  a limited participant pool yields some genuinely long chains instead of 100 chains of length one.
  (`headWeight()` in `server/src/services/chain-rules.ts` — change it there.)
* The head is **leased** to that participant for `ASSIGNMENT_TTL_MIN` (default 20 min). If they never
  submit, the lease expires and the head goes back to the pool. Chains are strictly linear (no forks).
* Model hops run in a background worker (`model-worker.ts`) polling `model_jobs` every 15 s, 3 retries.

### Model providers (free tiers)

| Hop kind | What happens | Provider |
|---|---|---|
| `LLM_TEXT` (text chains) | read passage → "write what you remember" | Gemini 2.5 Flash (or Groq Llama 3.3 if only Groq key set) |
| `ALM_AUDIO` (audio chains) | Gemini **listens to the audio directly** → recalled text → Gemini TTS → WAV | Gemini |
| `WHISPER_AUDIO` (audio chains) | Groq **Whisper** transcribes → Llama recalls → Gemini TTS → WAV | Groq + Gemini |

`AUDIO_MODEL_KIND=ALTERNATE` (default) alternates ALM / Whisper per model hop when both keys are present.
The recall prompt is in `server/src/providers/prompts.ts`. Model hops store the recalled text, the audio,
the model names, and (for Whisper) the intermediate transcript in `metadata`.

Keys: Gemini → https://aistudio.google.com/apikey · Groq → https://console.groq.com/keys. Both are free.
Swapping in another provider (e.g. Claude for text hops) means adding one file under `server/src/providers/`
and one branch in `model-worker.ts`.

## 3. Run locally

```bash
cp .env.example server/.env          # edit DATABASE_URL etc.
docker compose up -d                 # PostgreSQL 16 on :5432 (or use any Postgres)
pnpm install
pnpm dev                             # API :3000 (migrates automatically) + Vite :5173
```

Open http://localhost:5173. With `GOOGLE_CLIENT_ID` empty and `DEV_LOGIN=true` you can sign in with any
email. Admin: http://localhost:5173/admin with `ADMIN_TOKEN`.

Production-style single process: `pnpm build && pnpm start` (serves the SPA from the API on `PORT`).

### Seeds

Admin UI → "Add seed", or bulk import from a folder:

```
seeds/
  text/bn/001.txt  002.txt …        one paragraph per file
  audio/bn/001.wav 002.mp3 …        ≤ 60 s each (WAV recommended; mp3/ogg accepted)
```

```bash
ADMIN_TOKEN=... pnpm seed:import ./seeds --base https://your-app.up.railway.app
```

### Tests

```bash
pnpm test                                        # unit tests (chain rules, weighting, composition)
DATABASE_URL=postgres://…/whisper_chain_test pnpm test   # + worker integration tests (providers mocked)
pnpm typecheck
```

## 4. Deploy on Railway

1. Push this folder to a Git repo. In Railway: **New Project → Deploy from GitHub repo**.
2. **Add a PostgreSQL** plugin to the project; Railway injects `DATABASE_URL` into the service automatically
   (check it under the service → Variables; if not, add a reference `${{Postgres.DATABASE_URL}}`).
3. Set service variables: `SESSION_SECRET`, `ADMIN_TOKEN`, `GOOGLE_CLIENT_ID`, `GEMINI_API_KEY`,
   `GROQ_API_KEY`, `NODE_ENV=production`, plus any chain-rule overrides from `.env.example`.
4. `railway.json` already sets the build (`pnpm install && pnpm build`) and start (`pnpm start`) commands
   and the `/api/health` health check. Migrations run on boot.
5. Generate a domain (Settings → Networking). Audio recording requires HTTPS, which Railway provides.

Audio is stored in Postgres (`blobs` table), so no volume is needed. 50 chains × 6 hops × ~2 MB WAV ≈ 600 MB
per modality worst case; fine for Railway Postgres.

### Google sign-in

Google Cloud Console → APIs & Services → Credentials → **OAuth client ID (Web application)**.
Authorised JavaScript origins: `http://localhost:5173`, `http://localhost:3000`, and your Railway domain.
Put the client id in `GOOGLE_CLIENT_ID`. No client secret is needed (ID-token flow, verified server-side).

## 5. Data model and export

```
participants   who; consent flags; resume_code
chains         code, modality, language, composition, max_hops, status
hops           chain_id, hop_index (0 = seed), parent_hop_id, contributor_type (SEED|HUMAN|MODEL),
               participant_id | model_name, text_content, audio_blob_id, listen_count, takes_count,
               read_seconds, metadata (jsonb)
assignments    the lease of a chain head to a participant (ACTIVE|SUBMITTED|EXPIRED|ABANDONED)
model_jobs     queue for model hops (PENDING|RUNNING|DONE|FAILED)
blobs          audio bytes (WAV)
```

Export (admin): `GET /api/admin/export.json` (add `?pii=1` to include names/emails) and
`GET /api/admin/export.zip` = `data.json` + `audio/<CHAIN>/hop-NN-<id>.wav`. Both are linked from `/admin`.

## 6. API summary

```
GET  /api/config                         languages, limits, auth mode
POST /api/auth/google | /auth/dev | /auth/resume | /auth/logout
GET  /api/me?language=bn                 participant, progress, active task, availability
PUT  /api/me/profile                     name, gender, study_level, consent_*, preferred_language
GET  /api/me/resume-code                 code, url, QR data-url
POST /api/tasks/start                    {modality, language} → weighted random head, leased
GET  /api/tasks/:id                      state
GET  /api/tasks/:id/audio                source audio (fetch-limited)
GET  /api/tasks/:id/text                 source text (starts 5-min clock; 403 once hidden)
POST /api/tasks/:id/hide                 end reading early
POST /api/tasks/:id/submit-text          {text}
POST /api/tasks/:id/submit-audio         multipart: audio (wav), listen_count, takes_count
POST /api/tasks/:id/abandon
POST /api/transliterate                  {text, language} → candidates
GET  /api/admin/overview | /chains/:id | /hops/:id/audio | /export.json | /export.zip
POST /api/admin/seeds (multipart) | /jobs/:id/retry          (header x-admin-token)
```

## 7. Layout

```
server/src
  config.ts               env + language list
  migrations/             Knex migration (runs on boot)
  services/chain-rules.ts pure rules: model-hop schedule, weighting, composition   ← tweak here
  services/chains.service.ts     seeds, hops, what happens after a hop lands
  services/assignment.service.ts candidate set, probabilistic pick, leases, limits, submit
  services/model-worker.ts       background model hops
  providers/                     gemini.ts, groq.ts, prompts.ts, wav.ts
  routes/                        auth, tasks, admin, transliterate
web/src
  views/                  Login, Profile, Home, AudioTask, TextTask, Admin, Resume
  components/             AudioRecorder (MediaRecorder → WAV), TranslitTextarea
```
