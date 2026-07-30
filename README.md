# RelayForge

Cloud-native webhook delivery platform. Ingests events, routes them to subscribed destinations, and guarantees at-least-once delivery with retries, exponential backoff, and dead-letter queue.

Built to explore the same distributed-systems patterns used by Stripe, Segment, and AWS EventBridge.

**Live demo:** https://relayforge.fly.dev — health check at [`/health`](https://relayforge.fly.dev/health)
**Admin console:** https://relayforge.fly.dev/admin (token-gated)
**Stack:** Node.js · TypeScript · Fastify · Prisma · PostgreSQL · Redis · React · Docker · Fly.io · GitHub Actions

**Production:** 2 machines in `gru` (São Paulo), horizontally scaled with `SELECT FOR UPDATE SKIP LOCKED` — no double-deliveries. Per-tenant rate limiting via Upstash Redis. Operator dashboard for triaging dead-letter deliveries.

---

## Why this exists

Sending webhooks reliably is deceptively hard:

- The receiver's server might be down for 30 seconds — you can't drop the event.
- The receiver might respond `200 OK` but silently fail — you need retries.
- The same event might arrive twice — you need idempotency.
- The receiver has to prove the payload came from you — you need signatures.
- If you scale to more than one worker, the same delivery must not go out twice — you need row-level locking.

RelayForge solves all of these using battle-tested patterns.

---

## Architecture

```mermaid
flowchart LR
    Client[Client App] -->|POST /v1/events| API[Fastify API]
    API -->|1 transaction| DB[(PostgreSQL)]
    DB --> Outbox[OutboxEvent]
    Outbox --> OW[Outbox Worker]
    OW -->|creates| Deliveries[Delivery rows]
    Deliveries --> DW[Delivery Worker]
    DW -->|HMAC-signed POST| Webhook[Destination Webhook]
    Webhook -->|2xx| Delivered[DELIVERED]
    Webhook -->|5xx / timeout| Retry[RETRYING + backoff]
    Webhook -->|4xx / max attempts| DLQ[DEAD_LETTER]
```

**Data flow:**

1. **Ingestion** — Client POSTs event with an `Idempotency-Key`. Event + OutboxEvent saved in a single DB transaction.
2. **Routing** — Outbox worker polls unprocessed events (using `SELECT FOR UPDATE SKIP LOCKED`), matches them to destinations by pattern (`payment.*`, `order.created`, `*`), creates one Delivery row per destination.
3. **Delivery** — Delivery worker claims `PENDING` deliveries with the same SKIP LOCKED pattern, signs the payload with HMAC-SHA256, sends the webhook.
4. **Retry / DLQ** — 5xx / network errors → exponential backoff (0s, 30s, 2min, 10min, 1h). 4xx → straight to DEAD_LETTER (permanent failure). Max 5 attempts.

Both workers run inside every app instance. In production, RelayForge runs **N machines in parallel** without duplicate deliveries — see [Horizontal scaling](#horizontal-scaling) below.

---

## Patterns implemented

| Pattern | Where | Why |
|---|---|---|
| **Transactional Outbox** | `events/service.ts` | Guarantees Event + delivery intent are saved atomically. If the worker crashes, nothing is lost. |
| **Idempotency** | Unique constraint `(tenantId, externalEventId)` | Duplicate requests return the same eventId, no double-processing. |
| **HMAC-SHA256 signing** | `lib/hmac.ts` | Receiver can verify the payload came from RelayForge. |
| **Exponential backoff** | `deliveries/service.ts` | Backs off aggressive retries to avoid hammering a struggling receiver. |
| **Dead-letter queue** | `DeliveryStatus.DEAD_LETTER` | Failed deliveries after max attempts (or 4xx) are quarantined for inspection. |
| **SELECT FOR UPDATE SKIP LOCKED** | `workers/*.ts` | Multiple workers claim non-overlapping batches of work without blocking each other. Enables horizontal scaling. |
| **Lease-based crash recovery** | `lockedAt` column, 60s TTL | If a worker crashes mid-processing, another worker reclaims the row after the lease expires — no manual intervention. |
| **Sliding-window rate limit** | `plugins/rateLimit.ts` | Per-tenant limit (100 req/60s) using a Redis sorted set. Sliding window (not fixed) prevents burst abuse at window boundaries. |
| **Fail-open cache** | `lib/redis.ts` | If Redis is unavailable, rate limiting is skipped rather than blocking requests — protection must never take the app down. |

---

## Horizontal scaling

The default naive approach — `SELECT ... WHERE status='PENDING' LIMIT 10` — breaks the moment you run more than one worker. Two workers running the same query see the same 10 rows and both try to deliver them. The receiver gets each webhook twice.

RelayForge solves this with the standard Postgres pattern:

```sql
BEGIN;
  -- Claim up to 10 rows, skipping ones another worker has already locked
  SELECT id FROM deliveries
  WHERE (status = 'PENDING' OR (status = 'RETRYING' AND next_attempt_at <= NOW()))
    AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '60 seconds')
  ORDER BY created_at ASC
  LIMIT 10
  FOR UPDATE SKIP LOCKED;

  -- Mark them as "mine" so other workers ignore them on the next tick
  UPDATE deliveries SET "lockedAt" = NOW() WHERE id = ANY($1);
COMMIT;

-- HTTP delivery happens OUTSIDE the transaction, so DB locks are held for
-- milliseconds, not for the full 5-second request timeout.
```

**Why this is safe under concurrency:**
- `FOR UPDATE` acquires a row-level lock for the transaction.
- `SKIP LOCKED` tells other workers running the same query to skip locked rows instead of waiting — no contention.
- The claim transaction is tiny (SELECT + UPDATE + COMMIT), so locks are released in <10ms.
- Once committed, `lockedAt = NOW()` also blocks the row from being re-picked at the WHERE clause level (belt and suspenders).

**Why crashes don't lose work:**
- If a worker dies after claiming but before delivering, its `lockedAt` stays set.
- After 60 seconds (`INTERVAL '60 seconds'` in the WHERE), any other worker can reclaim the row.
- No manual cleanup, no orphaned jobs, no cron. Recovery is automatic.

### Verified in production

Test setup: 2 worker instances on ports 3000 and 3001, both pointing to the same Postgres. Fire 60 events through the API, wait for delivery, then query the DB:

```
=== RESULT ===
Total deliveries:         60
DELIVERED:                60
DEAD_LETTER:              0
Total attempts (HTTP):    60
Deliveries with >1 successful HTTP call (DUPLICATES): 0

OK — SKIP LOCKED works. No duplicate deliveries.
```

Every delivery went through exactly once, despite two workers racing for the same rows. See [`test-parallel-workers.mjs`](test-parallel-workers.mjs) for the harness.

The same code runs in production on Fly.io across 2 machines in `gru`:

![Fly.io machines](docs/fly-machines.png)

---

## Admin console (operator dashboard)

Building a delivery platform isn't finished when deliveries are sent — someone has to **operate it** when they fail. RelayForge ships with a small React dashboard for triaging dead-letter deliveries: inspect the payload, read the failure attempts, and requeue the delivery once the receiver is fixed.

**Screenshot:**

![Dead-letter console](docs/admin-dashboard.png)

**How it works:**
- `GET /admin` — serves a single-file React app (React + Babel via CDN, no separate build).
- `GET /admin/dead-letters` — paginated list of `DEAD_LETTER` deliveries.
- `GET /admin/dead-letters/:id` — full detail (event payload + every `DeliveryAttempt`).
- `POST /admin/dead-letters/:id/replay` — resets the delivery to `PENDING`; the existing delivery worker picks it up on the next tick and retries the whole flow (no duplicated logic).

**Security:**
- Admin routes require an `X-Admin-Token` header, compared to `env.ADMIN_TOKEN` with `crypto.timingSafeEqual` — constant-time comparison to prevent timing attacks that could otherwise leak the token character-by-character.
- Auth is a separate plugin from tenant auth (`plugins/adminAuth.ts` vs `plugins/auth.ts`) — admins are platform operators, not tenants.
- If `ADMIN_TOKEN` is not set, the entire admin API returns `503`. Admin is opt-in.

---

## Stack

- **Node.js 20 + TypeScript** (strict mode)
- **Fastify 5** — HTTP framework (faster than Express, first-class TS support)
- **PostgreSQL 16** via **Prisma ORM** — type-safe DB access, raw SQL for `FOR UPDATE SKIP LOCKED`
- **Redis 7** via **ioredis** — per-tenant sliding-window rate limiting (ZSET-based)
- **React 18** (via CDN) — admin dashboard, served as a single HTML file by Fastify
- **Docker Compose** — local infra (Postgres + Redis)
- **Vitest** — unit + integration tests
- **MSW** — HTTP mocking for delivery tests
- **Zod** — runtime validation of API inputs
- **Fly.io** — container hosting, multi-machine deploy in `gru` region
- **Neon** — serverless Postgres for production
- **Upstash** — serverless Redis for production
- **GitHub Actions** — CI/CD, push to `main` triggers a full deploy

---

## Deployment (CI/CD)

Every push to `main` triggers `.github/workflows/deploy.yml`:

1. **Checkout** the repo on a GitHub-hosted runner.
2. **Build** the multi-stage Docker image on Fly's remote builder.
3. **Push** the image to Fly's registry.
4. **Run migrations** — Fly's `release_command` (`npx prisma migrate deploy`) applies any new Prisma migrations against Neon before rolling out the new image.
5. **Rollout** — Fly replaces machines one at a time (rolling deploy, no downtime).
6. **Scale** — `fly scale count 2 --region gru` ensures 2 machines are running (idempotent).

No manual `fly deploy` from a developer's laptop. Ever.

---

## Getting started

```bash
# 1. Clone and install
git clone https://github.com/guievisk/relayforge.git
cd relayforge
npm install

# 2. Copy env
cp .env.example .env

# 3. Start Postgres + Redis
docker compose up -d

# 4. Point at local Postgres and apply migrations
export DATABASE_URL="postgresql://relayforge:relayforge@localhost:5434/relayforge?schema=public"
npx prisma migrate deploy
npm run prisma:seed
# ^ prints your API key. Save it.

# 5. Run the API + workers
npm run dev
```

In a second terminal, run the fake receiver:

```bash
npx tsx src/chaos-server.ts
```

Then send an event:

```bash
curl -X POST http://localhost:3000/v1/events \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Idempotency-Key: evt_test_1" \
  -H "Content-Type: application/json" \
  -d '{"type":"payment.approved","data":{"amount":100}}'
```

To reproduce the concurrency test with 2 parallel workers, see [`test-parallel-workers.mjs`](test-parallel-workers.mjs).

---

## Try the live demo

The app is deployed at `https://relayforge.fly.dev`. Check it's alive:

```bash
curl https://relayforge.fly.dev/health
# {"status":"ok"}
```

Ingesting events requires an API key (issued per tenant). The `/health` endpoint is public and confirms the API is up.

---

## API

### `POST /v1/events`

Ingest a new event.

**Headers:**
- `Authorization: Bearer <api_key>` — required
- `Idempotency-Key: <string>` — required. Same key = same event, no duplicates.
- `Content-Type: application/json`

**Body:**
```json
{
  "type": "payment.approved",
  "source": "billing-service",
  "data": { "amount": 100, "currency": "usd" }
}
```

**Response 202:**
```json
{ "eventId": "uuid", "status": "accepted" }
```

### Webhook payload (sent to destinations)

**Headers:**
- `X-RelayForge-Event-Id: <uuid>`
- `X-RelayForge-Signature: sha256=<hex>` — HMAC-SHA256 of body using destination secret

**Body:** JSON with `eventId`, `type`, `data`.

---

## Testing

```bash
npx vitest run
```

**12 tests across 3 suites:**
- `matchesPattern` — unit tests for event routing (6 tests)
- `createEvent` — integration tests for idempotent ingestion (2 tests)
- `deliverOne` — integration tests for delivery + retry + DLQ using MSW (4 tests)

Integration tests use a separate `relayforge_test` database to avoid polluting dev data.

Plus [`test-parallel-workers.mjs`](test-parallel-workers.mjs) — end-to-end concurrency test with 2 workers racing on the same Postgres.

---

## Project structure

```
src/
├── app.ts                          Fastify app assembly
├── server.ts                       Entry point (HTTP + workers)
├── chaos-server.ts                 Fake webhook server for local testing
├── config/env.ts                   Env validation (Zod)
├── lib/
│   ├── prisma.ts                   Prisma singleton
│   ├── redis.ts                    Redis singleton
│   ├── hash.ts                     API key hashing
│   └── hmac.ts                     Webhook payload signing
├── plugins/
│   ├── auth.ts                     API key auth (injects tenant into request)
│   ├── adminAuth.ts                Admin token auth (X-Admin-Token, timing-safe)
│   └── rateLimit.ts                Per-tenant rate limit (Redis sliding window)
├── modules/
│   ├── events/                     Event ingestion + routing
│   │   ├── routes.ts               POST /v1/events
│   │   └── service.ts              createEvent, matchesPattern, processOutboxEvent
│   ├── deliveries/
│   │   └── service.ts              deliverOne + admin queries (list, replay dead-letters)
│   └── admin/
│       ├── routes.ts               /admin/dead-letters (list, detail, replay)
│       └── dashboard.ts            React SPA served at /admin
└── workers/
    ├── outbox-worker.ts            Polls OutboxEvent with FOR UPDATE SKIP LOCKED
    └── delivery-worker.ts          Polls Deliveries with FOR UPDATE SKIP LOCKED

prisma/
├── schema.prisma                   8 models with lockedAt columns on Delivery + OutboxEvent
├── migrations/                     Versioned SQL migrations (applied by CI on every deploy)
└── seed.ts                         Creates test tenant + API key

.github/workflows/
└── deploy.yml                      Build + migrate + deploy + scale on push to main
```

---

## Roadmap

- [x] Ingestion API with idempotency
- [x] Transactional outbox
- [x] Event routing (pattern matching)
- [x] HMAC-signed delivery
- [x] Retry with exponential backoff
- [x] Dead-letter queue
- [x] Unit + integration tests
- [x] Deployed to Fly.io with Neon Postgres
- [x] `SELECT FOR UPDATE SKIP LOCKED` for safe horizontal scaling
- [x] Lease-based crash recovery (60s TTL on `lockedAt`)
- [x] CI/CD pipeline (GitHub Actions → Fly.io)
- [x] Running on 2 machines in production
- [x] Rate limiting per tenant (Redis, sliding window) — verified in prod: 100 allowed, rest 429
- [x] Admin API to list/replay dead-letter deliveries (token-gated, timing-safe auth)
- [x] Admin dashboard (React) consuming the Admin API
- [ ] Metrics endpoint (Prometheus)
- [ ] Structured logging with request tracing
