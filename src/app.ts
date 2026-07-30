import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import authPlugin from './plugins/auth.js'
import adminAuthPlugin from './plugins/adminAuth.js'
import rateLimitPlugin from './plugins/rateLimit.js'
import eventsRoutes from './modules/events/routes.js'
import adminRoutes from './modules/admin/routes.js'
import { dashboardHtml } from './modules/admin/dashboard.js'

export function buildApp() {
  const app = Fastify({
    logger: {
      transport: { target: 'pino-pretty' },
    },
  })

  app.register(sensible)
  app.register(authPlugin)
  app.register(adminAuthPlugin)
  app.register(rateLimitPlugin)

  app.get('/health', async () => ({ status: 'ok' }))

  // Dashboard de operacao (HTML publico; a UI pede o token e chama /admin/* protegido)
  app.get('/admin', async (_request, reply) => {
    return reply.type('text/html').send(dashboardHtml)
  })

  app.register(eventsRoutes, { prefix: '/v1' })
  app.register(adminRoutes, { prefix: '/admin' })

  return app
}
