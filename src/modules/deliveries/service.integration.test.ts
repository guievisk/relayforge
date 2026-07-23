import { describe, it, expect, beforeEach, afterAll, beforeAll, afterEach } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { prisma } from '../../lib/prisma.js'
import { deliverOne } from './service.js'

// Servidor HTTP falso que intercepta o fetch
const server = setupServer()

beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

let tenantId: string
let destinationId: string
let eventId: string

beforeEach(async () => {
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

  const dest = await prisma.destination.create({
    data: { tenantId, url: 'http://fake.local/hook', secret: 'test_secret' },
  })
  destinationId = dest.id

  const event = await prisma.event.create({
    data: {
      tenantId,
      externalEventId: 'evt_test',
      type: 'payment.approved',
      payload: { amount: 100 },
    },
  })
  eventId = event.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('deliverOne (integration)', () => {
  it('marks as DELIVERED on 200', async () => {
    // Fake webhook responde 200
    server.use(http.post('http://fake.local/hook', () => HttpResponse.text('ok', { status: 200 })))

    const delivery = await prisma.delivery.create({
      data: { eventId, destinationId, status: 'PENDING' },
    })

    await deliverOne(delivery.id)

    const updated = await prisma.delivery.findUnique({ where: { id: delivery.id } })
    expect(updated?.status).toBe('DELIVERED')
    expect(updated?.attemptCount).toBe(1)

    const attempts = await prisma.deliveryAttempt.findMany({ where: { deliveryId: delivery.id } })
    expect(attempts).toHaveLength(1)
    expect(attempts[0].httpStatus).toBe(200)
  })

  it('marks as RETRYING on 500 (com backoff agendado)', async () => {
    server.use(http.post('http://fake.local/hook', () => HttpResponse.text('boom', { status: 500 })))

    const delivery = await prisma.delivery.create({
      data: { eventId, destinationId, status: 'PENDING' },
    })

    await deliverOne(delivery.id)

    const updated = await prisma.delivery.findUnique({ where: { id: delivery.id } })
    expect(updated?.status).toBe('RETRYING')
    expect(updated?.attemptCount).toBe(1)
    expect(updated?.nextAttemptAt).not.toBeNull() // backoff agendado
  })

  it('marks as DEAD_LETTER on 400 (falha permanente)', async () => {
    server.use(http.post('http://fake.local/hook', () => HttpResponse.text('bad', { status: 400 })))

    const delivery = await prisma.delivery.create({
      data: { eventId, destinationId, status: 'PENDING' },
    })

    await deliverOne(delivery.id)

    const updated = await prisma.delivery.findUnique({ where: { id: delivery.id } })
    expect(updated?.status).toBe('DEAD_LETTER') // 4xx nao retenta
  })

  it('marks as DEAD_LETTER after MAX_ATTEMPTS 500s', async () => {
    server.use(http.post('http://fake.local/hook', () => HttpResponse.text('boom', { status: 500 })))

    const delivery = await prisma.delivery.create({
      data: { eventId, destinationId, status: 'PENDING', attemptCount: 4 }, // ja tentou 4x
    })

    await deliverOne(delivery.id) // 5a tentativa

    const updated = await prisma.delivery.findUnique({ where: { id: delivery.id } })
    expect(updated?.status).toBe('DEAD_LETTER')
    expect(updated?.attemptCount).toBe(5)
  })
})