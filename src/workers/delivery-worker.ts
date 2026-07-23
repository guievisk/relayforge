// Loop periodico: pega Deliveries prontas pra entrega e chama deliverOne.
import { prisma } from '../lib/prisma.js'
import { deliverOne } from '../modules/deliveries/service.js'

const POLL_INTERVAL_MS = 1000
let running = false

async function tick(logger?: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
  if (running) return
  running = true
  try {
    // Pega PENDING, e RETRYING cujo nextAttemptAt ja passou
    const batch = await prisma.delivery.findMany({
      where: {
        OR: [
          { status: 'PENDING' },
          { status: 'RETRYING', nextAttemptAt: { lte: new Date() } },
        ],
      },
      take: 10,
      orderBy: { createdAt: 'asc' },
    })

    for (const delivery of batch) {
      try {
        await deliverOne(delivery.id)
      } catch (err) {
        logger?.error({ deliveryId: delivery.id, err }, 'delivery failed unexpectedly')
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