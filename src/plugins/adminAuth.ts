// Protege as rotas /admin/* com um token estatico (X-Admin-Token).
// Separado do auth de tenant: admin nao e um tenant, e um operador da plataforma.
import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

// Comparacao em tempo constante: evita timing attack (descobrir o token
// medindo quanto tempo a comparacao leva ate divergir).
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

const adminAuthPlugin: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', async (request, reply) => {
    // So intercepta rotas /admin/* (a UI /admin em si e o HTML, liberado).
    if (!request.url.startsWith('/admin/')) return

    if (!env.ADMIN_TOKEN) {
      return reply.code(503).send({ error: 'Admin API disabled (ADMIN_TOKEN not set)' })
    }

    const token = request.headers['x-admin-token']
    if (typeof token !== 'string' || !safeEqual(token, env.ADMIN_TOKEN)) {
      return reply.code(401).send({ error: 'Invalid admin token' })
    }
  })
}

export default fp(adminAuthPlugin)
