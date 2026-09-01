import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { join } from 'node:path'
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
 
  app.register(fastifyStatic, {
    root: join(process.cwd(), 'public'),
    prefix: '/public/', // optional: default '/'
  })
 
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
  const { migrate } = await import('./core/migrate.js')
  await migrate()

  const app = await build()
  const stopJobs = startJobs({ log: app.log })
 
  let shuttingDown = false
  const shutdown = async (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    app.log.info({ signal }, 'encerrando: parando jobs, fechando servidor, Postgres e Redis')
    try {
      stopJobs()
      await app.close()
      const { pool } = await import('./core/db.js')
      await pool.end()
      const { closeRedis } = await import('./core/redis.js')
      await closeRedis()
    } catch (err) {
      app.log.error({ err }, 'erro durante o encerramento')
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
 
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
}
 