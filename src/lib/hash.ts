// Hash SHA-256 pra API keys.
// Nunca guardamos a key em texto puro. Guardamos hash e comparamos hash.
import { createHash, randomBytes } from 'node:crypto'

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export function generateApiKey(): string {
  // Prefixo "rf_" ajuda a identificar visualmente (padrao Stripe/OpenAI: sk_..., pk_...)
  return 'rf_' + randomBytes(24).toString('hex')
}
