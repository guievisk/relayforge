import Fastify from "fastify"

const app =  Fastify({logger: true})

app.post('/success', async (request, reply) => {
    app.log.info({body: request.body}, 'webhook recebido em /sucess')
    return reply.code(200).send({ok: true})
})

app.post('/fail', async () => {
    throw new Error('simulated server error')
})

app.post('/slow', async (request, reply) => {
    await new Promise((r) => setTimeout (r,1000))
    return reply.code(200).send({ok: true})
})

let flakyCount = 0

app.post('/flaky', async (request, reply) => {
  flakyCount++
  if (flakyCount % 2 === 0) return reply.code(200).send({ ok: true })
  return reply.code(500).send({ error: 'flaky failure' })
})

app.listen({ port: 4000, host: '0.0.0.0' })
  .then(() => console.log('Chaos server on http://localhost:4000'))
  .catch((err) => { console.error(err); process.exit(1) })