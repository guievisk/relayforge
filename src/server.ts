// Ponto de entrada: sobe o servidor HTTP + o outbox worker.
import 'dotenv/config'
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { startOutboxWorker } from './workers/outbox-worker.js'
import { startDeliveryWorker } from './workers/delivery-worker.js'

const app = buildApp()

app.listen({ port: env.PORT, host: '0.0.0.0' })
  .then(() => {
    app.log.info(`RelayForge on http://localhost:${env.PORT}`)
    startDeliveryWorker(app.log)
    startOutboxWorker(app.log)
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
