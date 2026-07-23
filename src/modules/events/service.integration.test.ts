import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma } from '../../lib/prisma.js'
import { createEvent } from './service.js'

// Cria um tenant de teste antes de cada teste, limpa depois
let tenantId: string

beforeEach(async () => {
  // Limpa tudo (ordem importa por causa das FKs)
  await prisma.deliveryAttempt.deleteMany()
  await prisma.delivery.deleteMany()
  await prisma.outboxEvent.deleteMany()
  await prisma.event.deleteMany()
  await prisma.subscription.deleteMany()
  await prisma.destination.deleteMany()
  await prisma.apiKey.deleteMany()
  await prisma.tenant.deleteMany()

  const tenant = await prisma.tenant.create({ data: { name: 'test' } })
  tenantId = tenant.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('createEvent (integration)', () => {
  it('creates event + outbox atomically', async () => {
    const result = await createEvent({
      tenantId,
      idempotencyKey: 'evt_1',
      type: 'payment.approved',
      data: { amount: 100 },
    })

    expect(result.duplicate).toBe(false)

    const event = await prisma.event.findUnique({ where: { id: result.eventId } })
    const outbox = await prisma.outboxEvent.findUnique({ where: { eventId: result.eventId } })

    expect(event).not.toBeNull()
    expect(outbox).not.toBeNull()
  })

  it('returns duplicate=true on same idempotency key', async () => {
    const first = await createEvent({
      tenantId,
      idempotencyKey: 'evt_dup',
      type: 'payment.approved',
      data: { amount: 100 },
    })
    const second = await createEvent({
      tenantId,
      idempotencyKey: 'evt_dup',
      type: 'payment.approved',
      data: { amount: 100 },
    })

    expect(second.duplicate).toBe(true)
    expect(second.eventId).toBe(first.eventId) // MESMO id retornado

    // E o banco tem UMA linha só
    const count = await prisma.event.count()
    expect(count).toBe(1)
  })
})
