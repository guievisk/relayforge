// Seed standalone em JS puro — roda dentro do container do Fly (node prisma/seed.mjs).
// Nao depende de tsx nem de src/, so de @prisma/client e crypto (nativo).
import { PrismaClient } from '@prisma/client'
import { createHash, randomBytes } from 'node:crypto'

const prisma = new PrismaClient()

function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex')
}
function generateApiKey() {
  return 'rf_' + randomBytes(24).toString('hex')
}

async function main() {
  await prisma.deliveryAttempt.deleteMany()
  await prisma.delivery.deleteMany()
  await prisma.outboxEvent.deleteMany()
  await prisma.event.deleteMany()
  await prisma.subscription.deleteMany()
  await prisma.destination.deleteMany()
  await prisma.apiKey.deleteMany()
  await prisma.tenant.deleteMany()

  const tenant = await prisma.tenant.create({ data: { name: 'Loja de Teste' } })

  const rawKey = generateApiKey()
  await prisma.apiKey.create({
    data: { tenantId: tenant.id, keyHash: hashApiKey(rawKey), label: 'default' },
  })

  const destination = await prisma.destination.create({
    data: {
      tenantId: tenant.id,
      url: 'https://postman-echo.com/post', // echo publico: sempre responde 200
      secret: 'test-secret-change-me',
    },
  })

  await prisma.subscription.create({
    data: { destinationId: destination.id, eventPattern: 'payment.*' },
  })

  console.log('\n=== SEED CONCLUIDO ===')
  console.log('Tenant ID:', tenant.id)
  console.log('Destination ID:', destination.id)
  console.log('\n>>> GUARDA ESSA API KEY (nao aparece de novo) <<<')
  console.log('API Key:', rawKey)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
