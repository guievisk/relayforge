// Inspeciona o estado das entregas — roda dentro do Fly (node prisma/check.mjs).
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const deliveries = await prisma.delivery.findMany({
  include: { attempts: { orderBy: { attemptNumber: 'asc' } }, event: true },
  orderBy: { createdAt: 'desc' },
})

for (const d of deliveries) {
  console.log(`\nDelivery ${d.id}`)
  console.log(`  event: ${d.event.type}  status: ${d.status}  attempts: ${d.attemptCount}`)
  for (const a of d.attempts) {
    console.log(`    attempt #${a.attemptNumber} -> http ${a.httpStatus ?? a.errorCode} (${a.durationMs}ms)`)
  }
}

console.log(`\nTotal deliveries: ${deliveries.length}`)
await prisma.$disconnect()
