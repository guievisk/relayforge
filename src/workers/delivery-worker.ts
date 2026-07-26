// Loop periodico: pega Deliveries prontas pra entrega e chama deliverOne.
// Usa SELECT FOR UPDATE SKIP LOCKED pra permitir multiplos workers em paralelo
// sem entrega duplicada.

import { prisma } from '../lib/prisma.js'
import { deliverOne } from '../modules/deliveries/service.js'

const POLL_INTERVAL_MS = 1000
let running = false

async function tick(logger?: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
  if (running) return
  running = true
  try {
    // Reserva ate 10 deliveries prontas, ignorando as ja travadas por outros workers.
    // Transacao curta: so pra SELECT+UPDATE. O HTTP acontece fora, sem prender o Postgres.
    const claimed = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM deliveries
        WHERE (
          status = 'PENDING'
          OR (status = 'RETRYING' AND next_attempt_at <= NOW())
        )
        AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '60 seconds')
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      `
      if (rows.length === 0) return []
      const ids = rows.map(r => r.id)
      await tx.$executeRaw`
        UPDATE deliveries SET "lockedAt" = NOW() WHERE id = ANY(${ids}::text[])
      `
      return ids
    })

    for (const deliveryId of claimed) {
      try {
        await deliverOne(deliveryId)
      } catch (err) {
        logger?.error({ deliveryId, err }, 'delivery failed unexpectedly')
      }
    }
  } finally {
    running = false
  }
}

export function startDeliveryWorker(logger?: Parameters<typeof tick>[0]) {
  logger?.info({ intervalMs: POLL_INTERVAL_MS }, 'delivery worker starting')
  const timer = setInterval(() => tick(logger), POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
