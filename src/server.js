import Fastify from 'fastify'
import { authenticate } from './core/auth.js'
import { errorHandler } from './core/errors.js'
import { startJobs } from './core/jobs.js'
import { cors } from './core/cors.js'

/**
 * Cada módulo exporta um plugin Fastify default em src/modules/<nome>/index.js.
 * Adicione o seu à lista; não mexa em mais nada deste arquivo.
 */
const MODULES = ['guilds', 'members', 'xp', 'seasons', 'wars', 'identity', 'announce']

export async function build (opts = {}) {
  const app = Fastify({ logger: opts.logger ?? true })
  app.setErrorHandler(errorHandler)
  cors(app)   // antes do authenticate: preflight não carrega token

  await app.register(async (api) => {
    api.addHook('preHandler', authenticate)

    for (const name of MODULES) {
      const mod = await import(`./modules/${name}/index.js`).catch(err => {
        if (err.code === 'ERR_MODULE_NOT_FOUND') return null   // fase ainda não implementada
        throw err
      })
      if (mod) await api.register(mod.default)
    }
  }, { prefix: '/api/v1' })

  app.get('/health', async () => ({ ok: true }))   // fora do escopo autenticado
  return app
}

if (import.meta.filename === process.argv[1]) {
  const app = await build()
  startJobs({ log: app.log })
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
}
