// Cliente Redis opcional e fail-open.
// Se REDIS_URL nao esta setado, exporta null e quem depende degrada gracefully.
// Se Redis cai em runtime, ioredis reconecta sozinho e a gente loga o erro.
import Redis from 'ioredis'
import { env } from '../config/env.js'

export const redis: Redis | null = env.REDIS_URL
  ? new Redis(env.REDIS_URL, {
      // ioredis enfileira comandos durante (re)conexao e reenvia quando conecta.
      // Upstash (serverless) pode derrubar conexoes ociosas; deixar o offline queue
      // ligado evita que um comando falhe so porque a conexao estava reconectando.
      maxRetriesPerRequest: 3,
    })
  : null

if (redis) {
  redis.on('error', (err) => {
    // Nao process.exit — a app continua rodando (fail-open).
    // Rate limit fica temporariamente desativado ate o Redis voltar.
    console.error('[redis] error:', err.message)
  })
}
