import { createHmac } from 'node:crypto'

/**
 * Assina o payload com HMAC-SHA256 usando o secret do destination.
 * O receptor faz a mesma conta e compara — se bater, prova que veio de nós.
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}
