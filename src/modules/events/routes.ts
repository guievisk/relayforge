// So HTTP: parse body, valida, delega pro service. Sem regra de negocio.
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createEvent } from './service.js'

const eventBodySchema = z.object({
  type: z.string().min(1),
  source: z.string().optional(),
  data: z.record(z.unknown()),
})

const eventsRoutes: FastifyPluginAsync = async (app) => {
  app.post('/events', async (request, reply) => {
    const tenant = request.tenant!

    const idempotencyKey = request.headers['idempotency-key']
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      return reply.code(400).send({ error: 'Idempotency-Key header required' })
    }

    const parsed = eventBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid body',
        details: parsed.error.flatten().fieldErrors,
      })
    }

    const { eventId } = await createEvent({
      tenantId: tenant.id,
      idempotencyKey,
      type: parsed.data.type,
      source: parsed.data.source,
      data: parsed.data.data,
    })

    return reply.code(202).send({ eventId, status: 'accepted' })
  })
}

export default eventsRoutes
