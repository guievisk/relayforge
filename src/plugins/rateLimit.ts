// Rate limit por tenant usando sliding window no Redis (ZSET).
//
// Como funciona:
// - Pra cada tenant, mantemos um sorted set no Redis com timestamps das requests.
// - Em toda request: (1) removemos entradas mais velhas que WINDOW_MS,
//   (2) contamos quantas sobraram, (3) se < LIMIT, aceita e adiciona a atual;
//    se >= LIMIT, rejeita com 429.
// - Isso da uma janela DESLIZANTE real (nao reseta em bordas), diferente de
//   um simples counter com TTL (que permite burst na virada da janela).
//
// Fail-open: se o Redis esta fora, deixa passar (rate limit e protecao,
// nao logica de negocio — indisponibilidade nao pode derrubar a app).
import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { redis } from '../lib/redis.js'

const WINDOW_MS = 60_000 // janela de 60 segundos
const LIMIT = 100 // 100 requests por tenant por janela
const EXCLUDED_PATHS = new Set(['/health', '/'])

const rateLimitPlugin: FastifyPluginAsync = async (app) => {
  // Roda DEPOIS do auth (que injeta request.tenant). Sem tenant, nada a fazer.
  app.addHook('preHandler', async (request, reply) => {
    if (EXCLUDED_PATHS.has(request.url)) return
    if (!request.tenant) return // auth ja tratou 401
    if (!redis) return // fail-open: Redis nao configurado

    const now = Date.now()
    const key = `ratelimit:tenant:${request.tenant.id}`
    const windowStart = now - WINDOW_MS

    try {
      // Pipeline atomico: 4 comandos em 1 round-trip.
      // 1) Remove timestamps fora da janela
      // 2) Adiciona o timestamp atual (score = ts, member = ts + random pra evitar colisao)
      // 3) Conta quantos ainda estao dentro da janela
      // 4) Seta TTL na chave pra ela sumir se o tenant parar de usar
      const pipeline = redis.multi()
      pipeline.zremrangebyscore(key, 0, windowStart)
      pipeline.zadd(key, now, `${now}-${Math.random()}`)
      pipeline.zcard(key)
      pipeline.pexpire(key, WINDOW_MS)
      const results = await pipeline.exec()

      // results = [[null, removed], [null, added], [null, count], [null, expire]]
      const count = results?.[2]?.[1] as number | undefined
      if (count === undefined) return // resposta estranha, fail-open

      // Header informativo pro cliente saber quanto sobra
      reply.header('X-RateLimit-Limit', LIMIT.toString())
      reply.header('X-RateLimit-Remaining', Math.max(0, LIMIT - count).toString())

      if (count > LIMIT) {
        reply.header('Retry-After', Math.ceil(WINDOW_MS / 1000).toString())
        return reply.code(429).send({
          error: 'Rate limit exceeded',
          limit: LIMIT,
          windowSeconds: WINDOW_MS / 1000,
        })
      }
    } catch (err) {
      // Redis fora, timeout, o que for — fail-open.
      app.log.warn({ err, tenantId: request.tenant.id }, 'rate limit check failed, allowing request')
    }
  })
}

export default fp(rateLimitPlugin)
