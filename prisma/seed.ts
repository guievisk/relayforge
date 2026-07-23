import { PrismaClient } from '@prisma/client'
import { hashApiKey, generateApiKey } from '../src/lib/hash.js'

const prisma = new PrismaClient()

async function main() {
  // Limpa dados anteriores pra facilitar re-seed
  await prisma.deliveryAttempt.deleteMany()
  await prisma.delivery.deleteMany()
  await prisma.event.deleteMany()
  await prisma.subscription.deleteMany()
  await prisma.destination.deleteMany()
  await prisma.apiKey.deleteMany()
  await prisma.tenant.deleteMany()

  // Cria tenant
  const tenant = await prisma.tenant.create({
    data: { name: 'Loja de Teste' },
  })

  // Cria API key (mostra a key em texto UMA VEZ; salva so o hash)
  const rawKey = generateApiKey()
  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      keyHash: hashApiKey(rawKey),
      label: 'default',
    },
  })

  // Cria um destination que escuta payment.*
  const destination = await prisma.destination.create({
    data: {
      tenantId: tenant.id,
      url: 'https://postman-echo.com/post', // echo publico: sempre responde 200
      secret: 'test-secret-change-me',
    },
  })

  await prisma.subscription.create({
    data: {
      destinationId: destination.id,
      eventPattern: 'payment.*',
    },
  })

  console.log('\n=== SEED CONCLUIDO ===')
  console.log('Tenant ID:', tenant.id)
  console.log('Destination ID:', destination.id)
  console.log('\n>>> GUARDA ESSA API KEY (nao vai aparecer de novo) <<<')
  console.log('API Key:', rawKey)
  console.log('\nUsa assim: Authorization: Bearer ' + rawKey)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
