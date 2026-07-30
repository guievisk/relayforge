// Rotas de operacao (Admin API). Protegidas pelo adminAuth plugin (X-Admin-Token).
// So HTTP: valida input, delega pro service.
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
  listDeadLetters,
  getDeadLetter,
  replayDeadLetter,
} from '../deliveries/service.js'

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
})

const adminRoutes: FastifyPluginAsync = async (app) => {
  // Lista dead-letters (paginada)
  app.get('/dead-letters', async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten().fieldErrors })
    }
    const { limit, offset } = parsed.data
    const { items, total } = await listDeadLetters({ limit, offset })
    return reply.send({ items, total, limit, offset })
  })

  // Detalhe de uma dead-letter (com tentativas)
  app.get('/dead-letters/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const delivery = await getDeadLetter(id)
    if (!delivery) {
      return reply.code(404).send({ error: 'Dead-letter not found' })
    }
    return reply.send(delivery)
  })

  // Replay: volta a delivery pra PENDING pro worker reprocessar
  app.post('/dead-letters/:id/replay', async (request, reply) => {
    const { id } = request.params as { id: string }
    const updated = await replayDeadLetter(id)
    if (!updated) {
      return reply.code(404).send({ error: 'Dead-letter not found' })
    }
    return reply.send({ id: updated.id, status: updated.status, message: 'requeued for delivery' })
  })
}

export default adminRoutes
