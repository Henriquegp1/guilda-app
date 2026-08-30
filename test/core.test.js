import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyTwitchJwt } from '../src/core/auth.js'
import { EVENT_TYPES } from '../src/core/events.js'

const SECRET = Buffer.from('segredo-de-teste-32-bytes-aqui!!').toString('base64')
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

function makeJwt (claims, secretB64 = SECRET, header = { alg: 'HS256', typ: 'JWT' }) {
  const body = `${b64(header)}.${b64(claims)}`
  const sig = createHmac('sha256', Buffer.from(secretB64, 'base64')).update(body).digest('base64url')
  return `${body}.${sig}`
}

const valid = () => ({
  exp: Math.floor(Date.now() / 1000) + 60,
  channel_id: '123',
  user_id: 'u1',
  role: 'viewer',
})

test('aceita JWT válido e extrai as claims', () => {
  const auth = verifyTwitchJwt(makeJwt(valid()), SECRET)
  // channelId (o id interno) é resolvido pelo authenticate, não sai daqui.
  assert.deepEqual(auth, { twitchChannelId: '123', userId: 'u1', opaqueUserId: null, role: 'viewer' })
})

test('rejeita assinatura de outro segredo', () => {
  const outro = Buffer.from('outro-segredo-de-32-bytes-aqui!!').toString('base64')
  assert.throws(() => verifyTwitchJwt(makeJwt(valid(), outro), SECRET), { code: 'UNAUTHORIZED' })
})

test('rejeita payload adulterado sem reassinar', () => {
  const token = makeJwt(valid(), SECRET)
  const [h, , s] = token.split('.')
  const forjado = `${h}.${b64({ ...valid(), role: 'broadcaster' })}.${s}`
  assert.throws(() => verifyTwitchJwt(forjado, SECRET), { code: 'UNAUTHORIZED' })
})

test('rejeita alg none (não aceita token sem assinatura real)', () => {
  const token = makeJwt(valid(), SECRET, { alg: 'none', typ: 'JWT' })
  assert.throws(() => verifyTwitchJwt(token, SECRET), { code: 'UNAUTHORIZED' })
})

test('rejeita token expirado', () => {
  const exp = { ...valid(), exp: Math.floor(Date.now() / 1000) - 1 }
  assert.throws(() => verifyTwitchJwt(makeJwt(exp), SECRET), { code: 'UNAUTHORIZED' })
})

test('rejeita token sem channel_id', () => {
  const { channel_id, ...sem } = valid()
  assert.throws(() => verifyTwitchJwt(makeJwt(sem), SECRET), { code: 'UNAUTHORIZED' })
})

test('EVENT_TYPES cobre todo tipo listado em docs/EVENTOS.md', async () => {
  const { readFile } = await import('node:fs/promises')
  const doc = await readFile(new URL('../docs/EVENTOS.md', import.meta.url), 'utf8')
  const tabela = doc.slice(doc.indexOf('## Registro'), doc.indexOf('## Regras'))

  const tipos = new Set()
  for (const [, celula] of tabela.matchAll(/^\|\s*((?:`[a-z_.]+`\s*\/?\s*)+)\|/gm)) {
    for (const [, t] of celula.matchAll(/`([a-z_]+\.[a-z_.]+)`/g)) tipos.add(t)
  }

  assert.ok(tipos.size > 25, `parser achou só ${tipos.size} tipos no doc`)
  const faltando = [...tipos].filter(t => !EVENT_TYPES.has(t))
  assert.deepEqual(faltando, [], 'tipos no doc que faltam em EVENT_TYPES')
})

test('todo job registrado aponta para uma função realmente exportada', async () => {
  const { JOBS } = await import('../src/core/jobs.js')
  const quebrados = []
  for (const job of JOBS) {
    const mod = await job.load().catch(() => null)
    if (!mod) continue                       // fase ainda não implementada
    if (typeof mod[job.fn] !== 'function') quebrados.push(`${job.name} -> ${job.fn}`)
  }
  assert.deepEqual(quebrados, [], 'jobs apontando para função inexistente')
})

test('cada job declara como quer ser chamado', async () => {
  const { JOBS } = await import('../src/core/jobs.js')
  for (const job of JOBS) {
    assert.ok(['nothing', 'client', 'channel'].includes(job.needs), `${job.name}: needs inválido`)
    assert.ok(job.everyMs >= 10_000, `${job.name}: intervalo agressivo demais`)
  }
})

describe('cache é opcional', () => {
  test('sem REDIS_URL, cached() cai na fonte da verdade', async () => {
    const antes = process.env.REDIS_URL
    delete process.env.REDIS_URL
    try {
      const { cached, redis, invalidate } = await import('../src/core/redis.js?sem-redis')
      assert.equal(await redis(), null)
      let chamadas = 0
      const fn = async () => { chamadas++; return { v: 42 } }
      assert.deepEqual(await cached('k', 60, fn), { v: 42 })
      assert.deepEqual(await cached('k', 60, fn), { v: 42 })
      assert.equal(chamadas, 2, 'sem cache, toda chamada consulta a fonte')
      await invalidate('k')            // não pode explodir sem Redis
    } finally {
      if (antes) process.env.REDIS_URL = antes
    }
  })

  test('URL inválida não derruba a request', async () => {
    const antes = process.env.REDIS_URL
    process.env.REDIS_URL = 'redis://127.0.0.1:1'   // porta fechada
    try {
      const { cached } = await import('../src/core/redis.js?redis-morto')
      assert.deepEqual(await cached('k2', 60, async () => 'ok'), 'ok')
    } finally {
      if (antes) process.env.REDIS_URL = antes; else delete process.env.REDIS_URL
    }
  })
})

describe('CORS para a extensão', () => {
  test('aceita origem de extensão da Twitch e recusa o resto', async () => {
    const { origemPermitida } = await import('../src/core/cors.js')
    assert.equal(origemPermitida('https://abc123.ext-twitch.tv'), true)
    assert.equal(origemPermitida('https://evil.com'), false)
    assert.equal(origemPermitida('https://ext-twitch.tv.evil.com'), false)
    assert.equal(origemPermitida('http://abc123.ext-twitch.tv'), false)  // exige https
    assert.equal(origemPermitida(undefined), false)
  })

  test('preflight responde 204 com os cabeçalhos, sem exigir token', async () => {
    const { build } = await import('../src/server.js')
    const app = await build({ logger: false })
    const origem = 'https://abc123.ext-twitch.tv'
    const r = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/me/guild',
      headers: { origin: origem, 'access-control-request-method': 'GET' },
    })
    assert.equal(r.statusCode, 204)
    assert.equal(r.headers['access-control-allow-origin'], origem)
    assert.match(r.headers['access-control-allow-headers'], /authorization/)
    assert.equal(r.headers.vary, 'Origin')
    await app.close()
  })

  test('origem não permitida não recebe cabeçalho de CORS', async () => {
    const { build } = await import('../src/server.js')
    const app = await build({ logger: false })
    const r = await app.inject({
      method: 'GET', url: '/health', headers: { origin: 'https://evil.com' },
    })
    assert.equal(r.headers['access-control-allow-origin'], undefined)
    await app.close()
  })
})
