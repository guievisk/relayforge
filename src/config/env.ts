// Le e valida variaveis de ambiente. Se faltar algo, a app nem sobe.
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  // REDIS_URL: se malformado, trata como undefined (fail-open) em vez de crashar a app.
  // Rate limit fica desativado ate a URL ser corrigida.
  REDIS_URL: z
    .string()
    .url()
    .optional()
    .catch(() => undefined),
  // Token pra proteger as rotas /admin. Se ausente, admin fica desabilitado.
  ADMIN_TOKEN: z.string().min(16).optional(),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Env invalido:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

if (process.env.REDIS_URL && !parsed.data.REDIS_URL) {
  console.warn('[env] REDIS_URL setado mas invalido — rate limit desativado ate corrigir')
}

export const env = parsed.data
