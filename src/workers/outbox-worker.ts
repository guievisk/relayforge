// Loop periodico: le OutboxEvents nao processados e chama o service.
// Usa SELECT FOR UPDATE SKIP LOCKED pra permitir multiplos workers em paralelo
// sem processar o mesmo outbox 2x.

import { prisma } from '../lib/prisma.js'
import { processOutboxEvent } from '../modules/events/service.js'

const POLL_INTERVAL_MS = 1000 // 1s: bom pra MVP. Producao usaria LISTEN/NOTIFY do Postgres

let running = false

async function tick(logger?: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void }) {
  if (running) return
  running = true

  try {
    // Reserva ate 10 outbox_events prontos, pulando os travados por outros workers.
    // Transacao curta: so pra SELECT+UPDATE. O processamento acontece fora.
    const claimed = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM outbox_events
        WHERE processed_at IS NULL
          AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - INTERVAL '60 seconds')
        ORDER BY created_at ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      `
      if (rows.length === 0) return []
      const ids = rows.map(r => r.id)
      await tx.$executeRaw`
        UPDATE outbox_events SET "lockedAt" = NOW() WHERE id = ANY(${ids}::text[])
      `
      return ids
    })

    for (const outboxId of claimed) {
      try {
        const count = await processOutboxEvent(outboxId)
        logger?.info({ outboxId, deliveriesCreated: count }, 'outbox processed')
      } catch (err) {
        logger?.error({ outboxId, err }, 'outbox processing failed')
      }
    }
  } finally {
    running = false
  }
}

export function startOutboxWorker(logger?: Parameters<typeof tick>[0]) {
  logger?.info({ intervalMs: POLL_INTERVAL_MS }, 'outbox worker starting')
  const timer = setInterval(() => tick(logger), POLL_INTERVAL_MS)
  return () => clearInterval(timer)
}
