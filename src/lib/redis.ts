// Cliente Redis compartilhado.
import Redis from 'ioredis'

export const redis = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: 3,
})

redis.on('error', (err) => console.error('Redis error:', err.message))
