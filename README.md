# Minimi

Minimi is a private, context-aware research assistant. It brings together a user's conversation history and current web sources to answer questions with citations, show what has changed over time, and support voice-based interactions.

## What it does

- Remembers conversations and retrieves relevant context for follow-up questions.
- Searches the web for current information and streams research progress and cited answers to the chat interface.
- Compares structured facts from conversation history with current sources to surface changes and new findings.
- Supports account-based conversation history, resumable chat turns, and source references.
- Accepts optional image and PDF attachments for questions.
- Provides optional speech transcription and playback, plus background audio transcription and processing tools.

## How it works

The React client connects to an Express API. PostgreSQL stores accounts, conversations, messages, sources, and durable chat events. Retrieval combines full-text search, vector similarity, and entity mentions. For research questions, Minimi retrieves relevant history, searches the web, extracts and compares claims, then generates and checks a cited response. A separate Python worker handles longer audio jobs.

See [DESIGN.md](./DESIGN.md) for the system architecture and implementation details.

## Technology

- **Client:** React, Vite, Tailwind CSS
- **API:** Node.js, Express 5, Prisma
- **Data:** PostgreSQL with pgvector
- **AI and search:** Gemini, optional Groq fallback, Tavily
- **Audio:** Python, FastAPI, Celery, Redis, FFmpeg, and optional Gnani services

## Requirements

- Node.js 20 or newer and npm
- PostgreSQL with the pgvector extension
- Gemini API key for model responses and embeddings
- Tavily API key for web research
- Docker and Docker Compose for the optional audio worker stack

The API can start without provider keys for health and setup diagnostics. Chat requests need a configured database and the relevant providers.

## Get started

Install dependencies and create a local environment file:

```sh
npm install
cp .env.example .env
```

Set at least `DATABASE_URL`, `GEMINI_API_KEY`, and `TAVILY_API_KEY` in `.env`. `GROQ_API_KEY` is optional and enables answer generation fallback. Keep provider credentials on the server and out of source control.

Generate the Prisma client and apply database migrations:

```sh
npm run db:generate
npm run db:migrate
```

Start the client and API:

```sh
npm run dev
```

The client is available at <http://localhost:5173> and the API at <http://localhost:3001>. Use `npm run dev:client` or `npm run dev:server` to start one service. Build the client with `npm run build` and start the API with `npm start`.

For local schema development against a disposable database, use `npm run db:migrate:dev`. The standard migration command applies pending migrations without resetting existing data.

## Optional audio worker

Set the required `GNANI_*` and `WORKER_INTERNAL_SECRET` values in `.env` to enable provider-backed voice features. Start the private API and Celery worker with Redis using:

```sh
docker compose -f worker/compose.yaml up --build
```

The worker API uses loopback port 8001 for local development. To stop the stack, run `docker compose -f worker/compose.yaml down`.

For development without Docker on macOS, prepare the Python environment with `sh worker/setup-local.sh`, start Redis with `sh worker/start-local-redis.sh`, then run `sh worker/run-local.sh api` and `sh worker/run-local.sh celery` in separate terminals. See [worker/requirements.txt](./worker/requirements.txt) and [worker/compose.yaml](./worker/compose.yaml) for worker setup.

Noise reduction and voice activity detection use local FFmpeg and CPU processing. Local pyannote speaker diarization is optional and requires accepting the model terms and configuring `INSTALL_PYANNOTE`, `PYANNOTE_ENABLED`, and `PYANNOTE_TOKEN` as described in `.env.example`.

## API overview

All application routes are under `/api` unless otherwise noted. Authenticated routes use a secure session cookie.

| Route | Purpose |
| --- | --- |
| `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout` | Manage an account session |
| `GET /api/auth/me` | Get the current account |
| `POST /api/chat` | Start or resume a streamed research chat turn |
| `GET /api/chat/turns/:id` | Read a saved chat turn |
| `GET /api/chat/turns/:id/events?after=N` | Resume persisted turn events after sequence `N` |
| `GET /api/conversations` | List paginated conversation history |
| `GET /api/conversations/:id` | Read a conversation and its sources |
| `PATCH /api/conversations/:id` | Rename a conversation |
| `DELETE /api/conversations/:id` | Delete a conversation and its history |
| `GET /api/health` | Check application and database readiness |
| `GET /api/metrics` | Read authenticated process metrics |

`POST /api/chat` accepts JSON such as `{ "conversationId": "…", "message": "…" }` and requires an `Idempotency-Key` header. It responds with server-sent events (SSE), including progress, findings, answer deltas, and source references. Reuse the idempotency key and send `X-After-Sequence` to resume after a disconnect. Voice and audio job routes are documented in their route modules under `server/src/modules/voice`, `server/src/modules/audio-processing`, and `worker/app/api`.

## Configuration

`.env.example` documents the available settings. Important groups include:

- Database and environment-specific credentials: `DATABASE_URL`, `DATABASE_URL_DEVELOPMENT`, `DATABASE_URL_PRODUCTION`
- Models and web search: `GEMINI_*`, `GROQ_*`, `TAVILY_API_KEY`
- Client origin and sessions: `CLIENT_ORIGIN`, `SESSION_*`, `COOKIE_SAME_SITE`, `TRUST_PROXY`
- Optional image uploads: `CLOUDINARY_*`, `MAX_IMAGE_SIZE_MB`, `MAX_PDF_SIZE_MB`
- Optional voice and background audio: `GNANI_*`, `WORKER_*`, `REDIS_URL`, `CELERY_*`

For Neon, use a pooled connection URL at runtime. Ensure pgvector is installed and available to the database role before running migrations. The Prisma script selects environment-specific database credentials according to `NODE_ENV`; tests do not silently use the development database.

## Deployment

Deploy the client and API behind HTTPS, with the client origin in `CLIENT_ORIGIN`. Set production database and provider credentials in the hosting platform's secret manager. Apply pending migrations with `npm run db:migrate` before deploying code that depends on them. The repository includes a CI workflow and a manual production migration workflow; the latter requires a GitHub `production` environment with `DATABASE_URL_PRODUCTION` configured.

Keep the audio worker on a private network, with durable Redis and audio storage configured for the deployment. Configure `TRUST_PROXY=true` only when the API runs behind a trusted proxy. See [DESIGN.md](./DESIGN.md) for security and scaling notes.

## Project checks

Run the JavaScript test suite with:

```sh
npm test
```

Worker tests require the development dependencies and can be run with:

```sh
pip install -r worker/requirements-dev.txt
pytest worker/tests
```

Provider-backed and database integration behavior requires configured services. Keep test credentials and databases separate from production.

## Current limitations

- Email verification, password recovery, MFA, and email-change flows are not implemented.
- Citation checking uses a heuristic based on source text and price matching; it does not guarantee that every claim is correct.
- Research rounds and total processing time are bounded, so complex questions may not receive complete source coverage.
- Speech providers and some audio processing options require separate provider credentials or local model setup.
- Long-audio chunking uses configured time boundaries with overlap; it does not currently detect silence boundaries for every cut.
