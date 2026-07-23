// Loop periodico: le OutboxEvents nao processados e chama o service.
// Roda no mesmo processo por enquanto (MVP). Depois vai virar processo separado
// em pod K8s quando escalar.

import { prisma } from '../lib/prisma.js'
import { processOutboxEvent } from '../modules/events/service.js'

const POLL_INTERVAL_MS = 1000 // 1s: bom pra MVP. Producao usaria LISTEN/NOTIFY do Postgres

let running = false

async function tick(logger?: { info: (o: unknown, msg?: string) => void; error: (o: unknown, msg?: string) => void }) {
  if (running) return
  running = true

  try {
    const batch = await prisma.outboxEvent.findMany({
      where: { processedAt: null },
      take: 10, // processa em batches pra nao travar
      orderBy: { createdAt: 'asc' },
    })

    for (const outbox of batch) {
      try {
        const count = await processOutboxEvent(outbox.id)
        logger?.info({ outboxId: outbox.id, deliveriesCreated: count }, 'outbox processed')
      } catch (err) {
        logger?.error({ outboxId: outbox.id, err }, 'outbox processing failed')
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
