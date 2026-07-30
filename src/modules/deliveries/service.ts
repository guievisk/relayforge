// Regra de negocio da entrega. NAO conhece worker/HTTP framework.
import { prisma } from '../../lib/prisma.js'
import { signPayload } from '../../lib/hmac.js'

const BACKOFF_SECONDS = [0, 30, 120, 600, 3600]
const MAX_ATTEMPTS = 5

function shouldRetry(status: number): boolean {
  if (status >= 200 && status < 300) return false 
  if (status === 408 || status === 429) return true 
  if (status >= 500) return true 
  return false 
}

export async function deliverOne(deliveryId: string): Promise<void> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { event: true, destination: true },
  })
  if (!delivery) return
  if (delivery.status === 'DELIVERED' || delivery.status === 'DEAD_LETTER') return

  const attemptNumber = delivery.attemptCount + 1
  const payloadStr = JSON.stringify({
    eventId: delivery.event.id,
    type: delivery.event.type,
    data: delivery.event.payload,
  })
  const signature = signPayload(payloadStr, delivery.destination.secret)

  const start = Date.now()
  let httpStatus: number | null = null
  let errorCode: string | null = null
  let responseExcerpt: string | null = null

  try {
    const res = await fetch(delivery.destination.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RelayForge-Event-Id': delivery.event.id,
        'X-RelayForge-Signature': `sha256=${signature}`,
      },
      body: payloadStr,
      signal: AbortSignal.timeout(5000), // 5s timeout
    })
    httpStatus = res.status
    responseExcerpt = (await res.text()).slice(0, 200)
  } catch (err) {
    errorCode = err instanceof Error ? err.name : 'unknown'
  }

  const durationMs = Date.now() - start

  // Registra a tentativa (auditoria completa)
  await prisma.deliveryAttempt.create({
    data: {
      deliveryId: delivery.id,
      attemptNumber,
      httpStatus,
      durationMs,
      errorCode,
      responseExcerpt,
    },
  })

  const success = httpStatus !== null && httpStatus >= 200 && httpStatus < 300

  if (success) {
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: { status: 'DELIVERED', attemptCount: attemptNumber, completedAt: new Date(), lockedAt: null },
    })
    return
  }

  const canRetry = httpStatus === null ? true : shouldRetry(httpStatus)
  const reachedMax = attemptNumber >= MAX_ATTEMPTS

  if (!canRetry || reachedMax) {
    await prisma.delivery.update({
      where: { id: delivery.id },
      data: { status: 'DEAD_LETTER', attemptCount: attemptNumber, lockedAt: null },
    })
    return
  }

  // Agenda proxima tentativa com backoff
  const backoffSec = BACKOFF_SECONDS[attemptNumber] ?? 3600
  const nextAttemptAt = new Date(Date.now() + backoffSec * 1000)

  await prisma.delivery.update({
    where: { id: delivery.id },
    data: { status: 'RETRYING', attemptCount: attemptNumber, nextAttemptAt, lockedAt: null },
  })
}

// ---- Admin: inspecao e replay de dead-letters ----

// Lista deliveries em DEAD_LETTER, paginada, mais recentes primeiro.
export async function listDeadLetters(params: { limit: number; offset: number }) {
  const [items, total] = await Promise.all([
    prisma.delivery.findMany({
      where: { status: 'DEAD_LETTER' },
      orderBy: { createdAt: 'desc' },
      take: params.limit,
      skip: params.offset,
      include: {
        event: { select: { id: true, type: true, source: true } },
        destination: { select: { id: true, url: true } },
      },
    }),
    prisma.delivery.count({ where: { status: 'DEAD_LETTER' } }),
  ])
  return { items, total }
}

// Detalhe de uma dead-letter: evento completo + todas as tentativas (auditoria).
export async function getDeadLetter(deliveryId: string) {
  return prisma.delivery.findFirst({
    where: { id: deliveryId, status: 'DEAD_LETTER' },
    include: {
      event: true,
      destination: { select: { id: true, url: true } },
      attempts: { orderBy: { attemptNumber: 'asc' } },
    },
  })
}

// Reprocessa uma dead-letter: volta pra PENDING e zera os contadores.
// O delivery worker pega na proxima rodada. Retorna null se nao existir/nao for DEAD_LETTER.
export async function replayDeadLetter(deliveryId: string) {
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, status: 'DEAD_LETTER' },
  })
  if (!delivery) return null

  return prisma.delivery.update({
    where: { id: delivery.id },
    data: {
      status: 'PENDING',
      attemptCount: 0,
      nextAttemptAt: null,
      completedAt: null,
      lockedAt: null,
    },
  })
}