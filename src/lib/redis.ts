// Cliente Redis opcional e fail-open.
// Se REDIS_URL nao esta setado, exporta null e quem depende degrada gracefully.
// Se Redis cai em runtime, ioredis reconecta sozinho e a gente loga o erro.
import Redis from 'ioredis'
import { env } from '../config/env.js'

export const redis: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      enableOfflineQueue: false, // se offline, comandos falham rapido em vez de enfileirar
    })
  : null

if (redis) {
  redis.on('error', (err) => {
    // Nao process.exit — a app continua rodando (fail-open).
    // Rate limit fica temporariamente desativado ate o Redis voltar.
    console.error('[redis] error:', err.message)
  })
}
