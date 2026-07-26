# RelayForge — Handoff para o v2

> Cola isso inteiro no início do chat novo. Depois escolhe a trilha do v2 (opções no final).

---

## Quem sou eu (contexto pessoal)

- Guilherme (Phantom), 18 anos, Goiânia-GO.
- Estudando IA na FATESG (3º semestre).
- Objetivo: pegar meu primeiro emprego como **dev backend júnior**.
- RelayForge é meu principal projeto de portfólio.
- Faço exercícios de backend todo dia (nível progredindo). Já terminei um exercício de "payment orchestrator".
- **Como eu quero trabalhar:** me passa o código pra eu revisar antes de seguir; eu quero **digitar o código eu mesmo** pra fixar; explica de forma **resumida e direta**. Português.

---

## O que é o RelayForge

Plataforma cloud-native de **entrega de webhooks** (webhook delivery platform). Ingere eventos, roteia pra destinos inscritos, e garante entrega **at-least-once** com retries, exponential backoff e dead-letter queue. Explora os mesmos patterns de sistemas distribuídos usados por Stripe, Segment e AWS EventBridge.

**Status atual do v1 (100% pronto e deployado):**
- Live: `https://relayforge.fly.dev` (health check em `/health` → `{"status":"ok"}`)
- GitHub: `github.com/guievisk/relayforge` (público)
- 12 testes automatizados passando (Vitest)
- Deploy: Docker multi-stage → Fly.io (região GRU/São Paulo), 1 máquina rodando
- Banco: Neon.tech Postgres (free tier, us-east-1)

---

## Stack

- **Node.js 20 + TypeScript** (strict mode)
- **Fastify 5** — HTTP framework
- **PostgreSQL 16** via **Prisma ORM**
- **Redis 7** — planejado (rate limiting, dedup cache) — ainda não usado em produção
- **Docker Compose** — infra local
- **Vitest** — testes unit + integração
- **MSW** (Mock Service Worker) — mock HTTP nos testes de entrega
- **Zod** — validação de input da API

---

## Arquitetura e fluxo de dados

```
Client App  --POST /v1/events-->  Fastify API
                                     |
                                     v (1 transação)
                                 PostgreSQL
                                     |
                              OutboxEvent (não processado)
                                     |
                                     v
                             Outbox Worker (polling)
                                     | cria 1 Delivery por destino que casa o pattern
                                     v
                              Delivery rows (PENDING)
                                     |
                                     v
                            Delivery Worker (polling)
                                     | assina payload com HMAC-SHA256, faz POST
                                     v
                            Destination Webhook
                              /        |          \
                          2xx       5xx/timeout    4xx / max attempts
                           |            |                 |
                       DELIVERED   RETRYING+backoff    DEAD_LETTER
```

**Passo a passo:**

1. **Ingestão** — Client faz POST do evento com `Idempotency-Key`. Event + OutboxEvent salvos numa única transação (Transactional Outbox).
2. **Roteamento** — Outbox worker faz polling dos eventos não processados, casa com destinos por pattern (`payment.*`, `order.created`, `*`), cria uma Delivery row por destino.
3. **Entrega** — Delivery worker pega deliveries `PENDING`, assina o payload com HMAC-SHA256, envia o webhook.
4. **Retry / DLQ** — 5xx/erro de rede → exponential backoff. 4xx → direto pra DEAD_LETTER (falha permanente). Máx 5 tentativas.

---

## Patterns implementados (v1)

| Pattern | Onde | Por quê |
|---|---|---|
| **Transactional Outbox** | `events/service.ts` | Garante que Event + intenção de entrega são salvos atomicamente. Se o worker crashar, nada se perde. |
| **Idempotency** | Unique constraint `(tenantId, externalEventId)` | Requests duplicados retornam o mesmo eventId, sem processamento duplo. |
| **HMAC-SHA256 signing** | `lib/hmac.ts` | Receiver verifica que o payload veio do RelayForge. |
| **Exponential backoff** | `deliveries/service.ts` | Recua nos retries pra não martelar um receiver com problema. |
| **Dead-letter queue** | `DeliveryStatus.DEAD_LETTER` | Deliveries que falharam após máx tentativas (ou 4xx) ficam em quarentena pra inspeção. |

---

## Estrutura do projeto

```
src/
├── app.ts                          Montagem do app Fastify
├── server.ts                       Entry point (HTTP + workers)
├── chaos-server.ts                 Servidor webhook fake pra teste local
├── config/env.ts                   Validação de env (Zod). REDIS_URL é optional.
├── lib/
│   ├── prisma.ts                   Singleton do Prisma
│   ├── redis.ts                    Singleton do Redis
│   ├── hash.ts                     Hash de API key (sha256)
│   └── hmac.ts                     Assinatura do payload do webhook
├── plugins/auth.ts                 Auth por API key (injeta tenant no request)
├── modules/
│   ├── events/
│   │   ├── routes.ts               POST /v1/events
│   │   └── service.ts              createEvent, matchesPattern, processOutboxEvent
│   └── deliveries/
│       └── service.ts              deliverOne (HTTP + lógica de retry)
└── workers/
    ├── outbox-worker.ts            Faz polling de OutboxEvent, cria Deliveries
    └── delivery-worker.ts          Faz polling de Deliveries PENDING/RETRYING, envia webhooks

prisma/
├── schema.prisma                   8 models
├── seed.ts                         Cria tenant de teste + API key (TS, local)
├── seed.mjs                        Seed standalone em JS (roda dentro do Fly)
└── check.mjs                       Script de inspeção de deliveries (roda no Fly)
```

**8 models do Prisma:** Tenant, ApiKey, Destination, Subscription, Event, Delivery, DeliveryAttempt, OutboxEvent.

---

## Detalhes importantes de implementação

- **matchesPattern(eventType, pattern)** — função pura de roteamento. Regras: `*` casa tudo; match exato; wildcard parcial `payment.*` casa `payment.approved` mas NÃO `payment.card.approved` (profundidade tem que bater); pattern mais específico não casa evento mais genérico.
- **BACKOFF_SECONDS** em `deliveries/service.ts` — valores de produção são `[0, 30, 120, 600, 3600]` (0s, 30s, 2min, 10min, 1h). ATENÇÃO: durante testes eu usei valores de demo `[0, 2, 3, 4, 5]`. **Conferir qual está no arquivo antes de seguir.**
- **MAX_ATTEMPTS = 5**.
- **Idempotência**: header `Idempotency-Key` obrigatório no POST. Mesma key = mesmo evento.
- **Assinatura**: `signPayload(payload, secret)` = HMAC-SHA256 hex. Enviado no header `X-RelayForge-Signature: sha256=<hex>`.

---

## API

### `POST /v1/events`
Headers: `Authorization: Bearer <api_key>`, `Idempotency-Key: <string>`, `Content-Type: application/json`
Body:
```json
{ "type": "payment.approved", "source": "billing-service", "data": { "amount": 100, "currency": "usd" } }
```
Resposta 202: `{ "eventId": "uuid", "status": "accepted" }`

### Webhook enviado ao destino
Headers: `X-RelayForge-Event-Id: <uuid>`, `X-RelayForge-Signature: sha256=<hex>`
Body: JSON com `eventId`, `type`, `data`.

---

## Testes (12, em 3 suites)

- `matchesPattern` — 6 unit tests de roteamento
- `createEvent` — 2 integration tests de ingestão idempotente
- `deliverOne` — 4 integration tests de entrega + retry + DLQ usando MSW

Integration tests usam banco separado `relayforge_test`. Config em `vitest.config.ts` (carrega `.env.test`, `fileParallel: false`). Rodar: `npx vitest run`.

---

## Infra / Deploy

- **Docker multi-stage** (builder + runner, node:20-alpine). Precisa `apk add openssl` nos dois estágios pro Prisma.
- **docker-entrypoint.sh** — respeita args (pra release_command do Fly rodar `npx prisma migrate deploy`), senão roda `node dist/server.js`.
- **fly.toml** — região `gru`, `release_command = 'npx prisma migrate deploy'`, `min_machines_running = 1`, health check em `/health`, 256mb / 1 cpu. **1 máquina só** (workers fazem polling sem lock distribuído — 2 máquinas causariam entrega duplicada).
- **Neon** é o banco (compute/data separados: Fly = compute, Neon = data). Usa endpoint com `-pooler` pra connection pooling. Neon auto-suspende após ~5min idle.
- `prisma` está em **dependencies** (não devDependencies) porque o release_command precisa em produção.

**Regras de segurança que eu aprendi (importante):**
- `.env` NUNCA vai pro git (está no `.gitignore`).
- Senha de connection string NUNCA colar no chat (eu já vazei uma senha do Neon uma vez e tive que resetar). Censurar senhas/keys em prints.

---

## Roadmap / o que falta (candidatos a v2)

- [ ] Rate limiting por tenant (Redis)
- [ ] Admin API pra listar/replay das dead-letter deliveries
- [ ] Métricas (Prometheus)
- [ ] Deploy com Redis também

---

## Escolha a trilha do v2

Diz qual dessas eu quero seguir (ou combina):

**1. Hardening de sistemas distribuídos** — `SELECT FOR UPDATE SKIP LOCKED` (permite escalar workers sem entrega duplicada), rate limiting por tenant com Redis, API de replay do dead-letter. Foco: backend puro, patterns que caem em entrevista.

**2. Infra / DevOps (AWS)** — CI/CD com GitHub Actions, migrar pra AWS (ECS ou Lambda), Docker otimizado. Foco: pipeline profissional, AWS no currículo.

**3. Observabilidade** — métricas Prometheus, structured logs (pino), health check avançado, dashboard. Foco: mostrar que sei operar o que deployo.

**Como eu quero trabalhar no v2:** me passa o código pra revisar, eu digito eu mesmo, explicações resumidas, uma coisa de cada vez.
