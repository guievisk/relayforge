// Fastify plugin: valida API key e injeta o tenant no request.
// Usa "decorateRequest" pra que outras rotas possam acessar request.tenant.
import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { hashApiKey } from '../lib/hash.js'

// Adiciona tipagem: request.tenant vira acessivel em qualquer rota
declare module 'fastify' {
  interface FastifyRequest {
    tenant?: { id: string; name: string }
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('tenant', undefined)

  // Nao roda em rotas publicas nem nas rotas /admin (essas usam adminAuth)
  app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/health' || request.url === '/') return
    if (request.url === '/admin' || request.url.startsWith('/admin/')) return

    const authHeader = request.headers['authorization']
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing or invalid Authorization header' })
    }

    const rawKey = authHeader.slice(7)
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(rawKey) },
      include: { tenant: true },
    })

    if (!apiKey) {
      return reply.code(401).send({ error: 'Invalid API key' })
    }

    request.tenant = { id: apiKey.tenant.id, name: apiKey.tenant.name }
  })
}

export default fp(authPlugin)
