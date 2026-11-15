# Minimi Context-Aware Research Agent

A conversational research app that retrieves relevant prior discussions, searches the web for current evidence, compares the two, and returns a cited answer. It uses a controlled JavaScript modular monolith rather than an open-ended tool loop.

## Features

- Persistent conversations and messages in PostgreSQL/Neon.
- Idempotent chat turns with durable status/events and a PostgreSQL outbox worker for retryable memory indexing and summaries.
- Per-user persisted research claims with source provenance and tenant-scoped retrieval.
- Hybrid history retrieval: PostgreSQL full-text search, Gemini embeddings with pgvector, entity mentions, temporal filters and reciprocal rank fusion.
- **Adaptive query planning**: search queries generated from memory entities, so referential questions ("has any of them changed?") get entity-specific searches.
- **Bounded agentic research loop**: iteratively searches, evaluates coverage, and refines queries for missing entities. Bounded by configurable rounds and time budget.
- **Content extraction**: fetches and reads full page content for top results, not just search snippets — essential for pricing comparisons.
- **Structured claim extraction + temporal diff engine**: extracts comparable claims from memory and web, runs an explicit historical-vs-current comparison, and feeds the structured diff to the LLM.
- **Self-verification**: checks each claim in the answer against its cited source text, flagging unsupported claims.
- Tavily web search with URL deduplication, timestamps, bounded concurrency and partial-failure reporting.
- Gemini answer generation streamed to a responsive React UI over SSE with progressive findings (memory matches, search results, diff table).
- Citation IDs validated against search results; claim content verified against source text.
- SSRF-aware bounded source extraction, Zod validation, rate limits, Helmet, configurable CORS and structured Pino logs.
- Protected operational metrics for HTTP latency/errors, provider latency/token usage, and background job outcomes.

## Architecture

See [DESIGN.md](./DESIGN.md) for the flow diagram, database choices, temporal behavior, trade-offs and scaling notes. Originals remain in `Message`; memory chunks and embeddings are derived retrieval aids.

## Stack

Node.js ES modules, Express 5, React, Vite, Tailwind CSS, Prisma, PostgreSQL/pgvector, Gemini API, Tavily Search API, Vitest and Supertest.

## Requirements

- Node.js 20 or newer and npm.
- PostgreSQL with pgvector (local PostgreSQL or Neon).
- Gemini API key for model answers and embeddings.
- Tavily API key for web research.

The server can start without provider keys so health and setup diagnostics work; missing providers are reported rather than simulated. The chat route requires a configured database to persist the request.

## Install and configure

```sh
npm install
cp .env.example .env
```

Set `DATABASE_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY` (recommended fallback), and `TAVILY_API_KEY` in `.env`. The server and Prisma scripts also accept `DATABASE_URL_DEVELOPMENT` / `GEMINI_API_KEY_DEVELOPMENT` and production equivalents, selected using `NODE_ENV`; tests do not silently use the development database. Gemini text generation falls back across configured Gemini models and then to Groq when available. After a Gemini 429, the process opens a short cooldown circuit so subsequent requests do not repeatedly hit the exhausted provider. Configure `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `GEMINI_MODEL_TIMEOUT_MS`, `LLM_PROVIDER_COOLDOWN_MS`, and `GROQ_MODEL` for the provider accounts. For Neon, use its pooled connection string for the runtime. Ensure pgvector is available to the database role before applying the migration.

## Database migrations

```sh
npm run db:generate
npm run db:migrate
```

The checked-in SQL migrations create relational tables, user/session tables, idempotent chat turns, outbox events, and pgvector/full-text indexes. The auth migration moves pre-existing conversations to a disabled legacy account so it cannot accidentally expose them to a newly registered user. `prisma migrate deploy` only applies pending migrations; it does not reset or drop data. For local schema iteration, use `npm run db:migrate:dev` against a disposable development database. Back up hosted data before schema changes.

## Run locally

```sh
npm run dev
```

The frontend runs at http://localhost:5173 and the API at http://localhost:3001. Use `npm run dev:client` or `npm run dev:server` to run one service. Production static assets can be built with `npm run build`; serve `client/dist` through a static host such as Vercel and deploy the Node API on Render or another Node host.

## Tests

```sh
npm test
```

Unit tests cover routing, dates, entity extraction, chunking, RRF, citations and retries. API tests cover validation and readiness behavior. `tests/evaluation/scenarios.json` contains 20 evaluation scenarios, including all three assignment examples; these are scenario fixtures, not an automated live-provider scorecard. Database/provider integration should be run against configured services with secrets kept outside source control.

## GitHub Actions workflow

`CI` runs automatically for pull requests and pushes to `main` or `master`. It installs the locked dependencies, validates the Prisma schema, generates the Prisma client, runs `npm test`, and builds the client. CI does not connect to or modify a real database; it uses a placeholder database URL only for Prisma commands.

`Apply production database migrations` is a manual workflow. Before using it, create a GitHub environment named `production` and add `DATABASE_URL_PRODUCTION` as an environment secret. Then open **Actions → Apply production database migrations → Run workflow**, select the `production` environment if prompted, and start the run. Wait for it to succeed before deploying application code that requires those schema changes. The workflow runs `npm run db:migrate`, which applies only pending migrations. For local or other-host deployments, run `npm run db:migrate` against the intended database before starting the new server version.

## API

- `POST /api/chat` — JSON `{ "conversationId?": "...", "message": "..." }`; responds with SSE events: `conversation`, `progress` (with `detail`), `findings` (memory matches, search results, diff entries), `delta`, `done` (with `sources`, `diff`, `diffSummary`, `searchRounds`), or `error`.
- `POST /api/chat` requires an `Idempotency-Key` header. Reuse the key and send `X-After-Sequence` to resume a turn's persisted SSE events after a disconnect.
- `GET /api/chat/turns/:id` — status and saved answer for an authenticated user's turn.
- `GET /api/chat/turns/:id/events?after=N` — persisted events after sequence `N`.
- `GET /api/conversations?limit=20&cursor=...` — paginated history.
- `GET /api/conversations/:id` — messages and attached sources.
- `PATCH /api/conversations/:id` — rename via `{ "title": "..." }`.
- `DELETE /api/conversations/:id` — cascade-delete the conversation and dependent history.
- `GET /api/health` — app and database readiness plus provider configuration state.
- `GET /api/metrics` — authenticated process-level latency, provider, and outbox metrics.

Responses use `{ success, data, error }` where applicable. SSE progress names are high-level UI stages and do not expose model reasoning. `POST /api/auth/signup`, `POST /api/auth/login`, and `POST /api/auth/logout` manage accounts; `GET /api/auth/me` reports the active account. Browser credentials are opaque server-side sessions stored in an HttpOnly cookie; no bearer token is embedded in the client bundle or local storage.

## Security status

The repository ignores environment files, local provider config, credentials, private key/keystore formats, local databases, logs, build output and common deployment state. Keep real credentials in `.env` locally and in the hosting provider's secret store after deployment. Do not commit `.env`.

Authentication uses scrypt password hashes, random opaque session tokens (only SHA-256 token hashes are stored), expiring/revocable database sessions, HttpOnly cookies, and per-user conversation ownership checks. Unsafe requests require an allowed `Origin` as CSRF protection. Production cookies are Secure; use HTTPS at the edge, set `TRUST_PROXY=true` only behind a trusted single proxy, and keep the UI/API on the same site where possible. `COOKIE_SAME_SITE=none` is available for cross-site deployments and always forces Secure cookies, but browsers may block third-party cookies; a same-site reverse proxy is preferred. Rate limits run before body parsing. Set `REDIS_REST_URL` and `REDIS_REST_TOKEN` for shared atomic request limits across instances; if Redis is unavailable the server logs the failure and falls back to a process-local limit. The LLM provider cooldown is also process-local; share it through Redis if running multiple API replicas at sustained load.

## Deployment

Deploy the client and API behind a shared HTTPS site or same-site domains (for example, `app.example.com` and `api.example.com`), set `CLIENT_ORIGIN`, `DATABASE_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `TAVILY_API_KEY`, and `TRUST_PROXY=true` when TLS terminates at one trusted edge proxy. Run the production migration workflow described above before deploying server changes that require pending migrations. Use a pooled Neon runtime URL and an appropriate direct URL only if your migration workflow requires it. Free-tier quotas and provider terms change; check current provider documentation before launch.

## Limitations

- Account email verification, password reset, MFA, and email-change flows are not implemented yet; add them before opening public self-service signup broadly.
- Date parsing covers common phrases, weekday recognition ("on Monday"), relative dates ("last week", "3 days ago"), and nearest-past month/day behavior; it does not yet ask follow-up questions for every ambiguous date.
- Structured claim extraction uses LLM-based extraction with a regex fallback; accuracy depends on the model and text quality.
- Self-verification uses keyword overlap and price matching; it is a heuristic check, not a full semantic verification.
- The agentic research loop is bounded by `MAX_SEARCH_ROUNDS` and `RESEARCH_BUDGET_MS`; complex questions with many entities may not get full coverage within the budget.
- Persistent claims and extractive rolling summaries are indexed asynchronously through the PostgreSQL outbox. Embeddings require the configured embedding provider; keyword and full-text retrieval remain available if embedding calls fail.
- The automated evaluation set is declarative; external-service and full database evaluation needs configured credentials and a test database.
- The response is emitted after research is complete; provider failover buffers an answer until the selected provider completes so a failed partial Gemini response cannot be duplicated or mixed with Groq output.

## Production system design notes

- Keep the current API as a modular monolith while traffic and team size are small. It keeps chat orchestration, auth, retrieval, and provider routing in one deployable unit without adding network hops.
- PostgreSQL is the source of truth for users, sessions, conversations, messages, and source records. Derived chunks and vectors can be rebuilt. Ownership is enforced in database queries, including hybrid memory retrieval.
- Put a shared Redis-compatible service in front of public endpoints for distributed rate limits and (at higher scale) provider circuit state. Current local fallbacks keep development usable but are not globally consistent across replicas.
- Keep provider keys server-side. Gemini is primary; Groq is a separately configured answer fallback. Add provider-specific timeouts, bounded retries with jitter, per-provider circuit breakers, usage/cost telemetry, and an operational alert on sustained 429s. A different provider does not fix Tavily, database, or embedding quotas.
- Research work uses a PostgreSQL outbox and persisted turn events, with idempotent client retries and SSE resume. At higher scale, move queue polling to dedicated worker replicas and add distributed concurrency controls.
- At launch, monitor request IDs, provider/model/status/latency, search rounds, token usage, and DB latency without logging prompts, passwords, cookies, or authorization data. Add backups and tested restore procedures before storing important conversation history.

## Additive voice and background audio layer

The optional voice layer adds server-side Gnani Prisma v3 and Timbre v3 adapters without changing the existing research path. Set the `GNANI_*` values in `.env`; the UI never receives the key. A recording is uploaded to `/api/v1/audio/jobs` and processed through the private FastAPI gateway and Celery worker. The local worker stack is separate from the existing app stack:

```sh
docker compose -f worker/compose.yaml up --build
```

Set a strong `WORKER_INTERNAL_SECRET` in `.env`. The worker API binds to loopback port 8001 for local development, Redis binds to loopback 6379, and uploaded files use a Docker volume. For production, place the worker API on a private network and configure a persistent storage volume and Redis AOF/backups. Stop the stack with `docker compose -f worker/compose.yaml down`.

New authenticated endpoints include `POST /api/v1/voice/transcribe` (raw audio body, filename in `X-Audio-Filename`), `POST /api/v1/voice/synthesize`, `POST /api/v1/voice/chat`, `POST /api/v1/audio/jobs` (raw file body, unique `Idempotency-Key`), `GET /api/v1/audio/jobs/:jobId`, `GET /api/v1/audio/jobs/:jobId/audio`, `POST /api/v1/audio/jobs/:jobId/cancel`, and `GET /api/v1/health/worker`. Short STT calls use Gnani’s synchronous endpoint; long uploads use batch processing and remain separate from the existing `/api/chat` workflow. The UI shows an editable transcript before sending it through the original chat API and can request speech for completed answers.

Prisma v3 REST supports up to 30 seconds per request. The batch worker currently splits long recordings at configured time/size heuristics, uploads supported parts, polls the provider, and retains per-file transcript metadata. Timbre long-form synthesis is queued and concatenates WAV parts. Evon hosted access remains disabled unless Gnani provides an account-specific, documented endpoint and schema; current answers continue to use the existing provider path. Real Gnani calls were not verified in this environment because no Gnani key is configured.

Current implementation limits: the public audio upload route accepts one file per request (the worker gateway can accept a bounded list); chunk cuts use a configured time boundary with a three-second overlap and currently do not search for silence boundaries; source audio uploads are capped by `MAX_AUDIO_UPLOAD_BYTES`; and the Express runtime needs `ffprobe` installed for immediate (<=30-second) STT validation. Job ownership/progress is held in Redis with AOF enabled by the local compose stack, not in a new Prisma table. Configure equivalent durable Redis persistence and audio-volume retention in production. Provider task retry behavior and chunk overlap reconstruction need end-to-end validation with account credentials and representative recordings before production use.

### Isolated noise and speaker processing

The additive authenticated endpoint `POST /api/v1/audio/processing-jobs` queues an independent audio processing task. Upload the audio as the raw request body and set `Idempotency-Key`, `X-Audio-Filename`, and `X-Audio-Processing-Mode` (`standard`, `noise_reduced`, or `multi_speaker`). Poll the returned job through `GET /api/v1/audio/jobs/:jobId`. The original upload is retained separately; FFmpeg creates a mono 16 kHz PCM working copy, then CPU WebRTC VAD provides speech and silence intervals. Standard mode leaves denoising and local diarization off. Noise-reduced mode conditionally uses FFmpeg's built-in `afftdn` FFT noise suppressor; if the installed filter fails, the worker falls back to the unfiltered working copy and records a warning. Multi-speaker mode retains Prisma's native speaker labels and can also run local pyannote when explicitly installed and configured. Segment timestamps and detected language are returned; overlapping/low-confidence segments are marked uncertain instead of being combined.

Prisma Batch documents native `with_denoise`, `with_diarization`, `num_speakers` and segment-level language results. The adapter preserves those capabilities for future provider configuration; this module uses local FFmpeg denoising and leaves Batch denoising off to avoid duplicate processing. The `webrtcvad-wheels` dependency is CPU-only and offers prebuilt CPython wheels. Local pyannote is off by default because its torch stack is large; opt in with `INSTALL_PYANNOTE=true`, `PYANNOTE_ENABLED=true`, and a `PYANNOTE_TOKEN` only after accepting the Hugging Face model conditions. The `speaker-diarization-community-1` model is CC BY 4.0, requires gated model access, and runs on CPU or CUDA; GPU is optional. Output labels are anonymized as Speaker 1, Speaker 2, etc. Install test dependencies and run worker tests with `pip install -r worker/requirements-dev.txt && pytest worker/tests`.

To run the worker without Docker on macOS, create its isolated Python environment with `sh worker/setup-local.sh`. Start local Redis with `sh worker/start-local-redis.sh`, then run `sh worker/run-local.sh api` and `sh worker/run-local.sh celery` in separate terminals. The worker binds to loopback port 8001 and uses `/private/tmp/minimi-audio` for development uploads. Restart the API after changing worker settings.
