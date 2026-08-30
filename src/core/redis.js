import { createClient } from 'redis'

/**
 * Redis é OPCIONAL. Sem `REDIS_URL`, ou com o servidor fora do ar, tudo aqui
 * devolve null / cai direto na fonte da verdade. Nenhuma rota pode falhar por
 * causa de cache: o Postgres é sempre a autoridade (ARQUITETURA).
 *
 * O que justifica isto no core em vez de num módulo: sem um lugar só, cada fase
 * reimplementa conexão e degradação do seu jeito — foi assim que a resolução de
 * canal virou quatro versões divergentes.
 */
let client = null
let connecting = null
let downUntil = 0

const RETRY_MS = 30_000
const CONNECT_MS = 1_000

/** Cliente conectado, ou null quando não há Redis utilizável agora. */
export async function redis () {
  if (!process.env.REDIS_URL) return null
  if (client?.isReady) return client
  if (Date.now() < downUntil) return null      // não martela o servidor caído
  if (connecting) return connecting

  connecting = (async () => {
    try {
      const c = createClient({
        url: process.env.REDIS_URL,
        socket: {
          connectTimeout: CONNECT_MS,
          // Sem isto o node-redis reconecta para sempre e `connect()` nunca resolve:
          // um Redis morto penduraria a request em vez de degradar. Desiste rápido;
          // quem controla a nova tentativa é o `downUntil` abaixo.
          reconnectStrategy: false,
        },
      })
      // Sem este handler, um erro de socket vira unhandled 'error' e derruba o processo.
      c.on('error', () => { downUntil = Date.now() + RETRY_MS })
      await c.connect()
      client = c
      return c
    } catch {
      downUntil = Date.now() + RETRY_MS
      return null
    } finally {
      connecting = null
    }
  })()

  return connecting
}

/**
 * Cache de leitura com TTL. `fn` é a fonte da verdade e roda sempre que o cache
 * não responde — por ausência, por miss ou por erro.
 *
 * Só para dado que pode estar alguns segundos velho (ranking, placar). Nunca
 * para o que decide uma escrita: nada aqui participa de transação.
 */
export async function cached (key, ttlSec, fn) {
  const r = await redis()
  if (!r) return fn()

  try {
    const hit = await r.get(key)
    if (hit !== null) return JSON.parse(hit)
  } catch {
    return fn()
  }

  const value = await fn()
  // Falha ao gravar não pode derrubar a request: o valor já é bom.
  try { await r.set(key, JSON.stringify(value), { EX: ttlSec }) } catch { /* segue */ }
  return value
}

/** Invalida chaves após uma escrita. Silencioso por design. */
export async function invalidate (...keys) {
  const r = await redis()
  if (!r || !keys.length) return
  try { await r.del(keys) } catch { /* o TTL resolve */ }
}

export async function closeRedis () {
  if (client?.isOpen) await client.quit()
  client = null
}
