import Fastify from 'fastify'
import sensible from '@fastify/sensible'
import authPlugin from './plugins/auth.js'
import eventsRoutes from './modules/events/routes.js'

export function buildApp() {
  const app = Fastify({
    logger: {
      transport: { target: 'pino-pretty' },
    },
  })

  app.register(sensible)
  app.register(authPlugin)

  app.get('/health', async () => ({ status: 'ok' }))

  app.register(eventsRoutes, { prefix: '/v1' })

  return app
}
