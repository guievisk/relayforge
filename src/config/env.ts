// Le e valida variaveis de ambiente. Se faltar algo, a app nem sobe.
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Env invalido:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
