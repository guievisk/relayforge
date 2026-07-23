// Regra de negocio dos EVENTOS. NAO conhece Fastify/HTTP.
import { prisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'

type CreateEventInput = {
  tenantId: string
  idempotencyKey: string
  type: string
  source?: string
  data: Record<string, unknown>
}

/**
 * Cria Event + OutboxEvent na MESMA transacao (atomico).
 * Retorna { eventId, duplicate }.
 */
export async function createEvent(input: CreateEventInput) {
  try {
    const event = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          tenantId: input.tenantId,
          externalEventId: input.idempotencyKey,
          type: input.type,
          source: input.source,
          payload: input.data as Prisma.InputJsonValue,
        },
      })
      await tx.outboxEvent.create({ data: { eventId: created.id } })
      return created
    })

    return { eventId: event.id, duplicate: false }
  } catch (err) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === 'P2002') {
      const existing = await prisma.event.findUnique({
        where: {
          tenantId_externalEventId: {
            tenantId: input.tenantId,
            externalEventId: input.idempotencyKey,
          },
        },
      })
      return { eventId: existing!.id, duplicate: true }
    }
    throw err
  }
}

/**
 * Verifica se um pattern casa com o type do evento.
 *   ("payment.approved", "payment.*") -> true
 *   ("order.created",    "payment.*") -> false
 */
export function matchesPattern(eventType: string, pattern: string): boolean {
  if (pattern === '*') return true
  if (pattern === eventType) return true

  const patternParts = pattern.split('.')
  const typeParts = eventType.split('.')
  if (patternParts.length !== typeParts.length) return false

  return patternParts.every((part, i) => part === '*' || part === typeParts[i])
}

/**
 * Processa um OutboxEvent: acha destinations que assinam esse type,
 * cria uma Delivery pra cada. Marca outbox como processed.
 */
export async function processOutboxEvent(outboxId: string): Promise<number> {
  const outbox = await prisma.outboxEvent.findUnique({
    where: { id: outboxId },
    include: { event: true },
  })
  if (!outbox || outbox.processedAt) return 0

  const event = outbox.event

  const destinations = await prisma.destination.findMany({
    where: { tenantId: event.tenantId, active: true },
    include: { subscriptions: true },
  })

  const matching = destinations.filter((dest) =>
    dest.subscriptions.some((sub) => matchesPattern(event.type, sub.eventPattern))
  )

  await prisma.$transaction(async (tx) => {
    if (matching.length > 0) {
      await tx.delivery.createMany({
        data: matching.map((dest) => ({
          eventId: event.id,
          destinationId: dest.id,
          status: 'PENDING' as const,
        })),
      })
    }
    await tx.outboxEvent.update({
      where: { id: outbox.id },
      data: { processedAt: new Date() },
    })
  })

  return matching.length
}
