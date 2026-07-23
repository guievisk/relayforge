// Cliente Prisma singleton, reusado no app inteiro.
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()
