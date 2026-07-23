import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'

config({ path: '.env.test' })

export default defineConfig({
  test: {
    environment: 'node',
    fileParallel: false, // testes que usam DB nao rodam em paralelo
  },
})