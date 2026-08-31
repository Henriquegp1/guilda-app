import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { build } from '../src/server.js'

/**
 * Testes de Integração HTTP: Módulo Announce.
 * Valida a fronteira de segurança, autorização e proteção de segredos via app.inject().
 */

const EXT_SECRET = 'eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHg=' // base64 de 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
process.env.TWITCH_EXT_SECRET = EXT_SECRET
process.env.ANNOUNCE_ENC_KEY = '0000000000000000000000000000000000000000000000000000000000000000'

// Helper para gerar JWT idêntico ao da Twitch (HS256)
function generateTwitchToken({ role = 'viewer', channelId = '123', userId = 'user-default' } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + 600,
    channel_id: String(channelId),
    user_id: userId,
    role
  })).toString('base64url')

  const signature = createHmac('sha256', Buffer.from(EXT_SECRET, 'base64'))
    .update(`${header}.${claims}`)
    .digest('base64url')

  return `${header}.${claims}.${signature}`
}

// Helper para gerar assinatura de Bot (HMAC-SHA256)
function generateBotSignature(body, secret, timestamp) {
  if (!secret) throw new Error('generateBotSignature: secret is required')
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

describe('Módulo Announce — Rotas HTTP', { skip: !process.env.DATABASE_URL }, () => {
  let app
  const channelIdStr = 'test-api-' + Math.random().toString(36).slice(2)
  let botSecret
  let botChannelStr

  before(async () => {
    app = await build({ logger: false })
    const { resolveChannel } = await import('../src/core/auth.js')
    await resolveChannel(channelIdStr)

    // Setup para os testes de Bot
    botChannelStr = 'test-bot-' + Math.random().toString(36).slice(2)
    await resolveChannel(botChannelStr)
    const rot = await app.inject({
      method: 'POST',
      url: '/api/v1/announce/secret/rotate',
      headers: { authorization: `Bearer ${generateTwitchToken({ role: 'broadcaster', channelId: botChannelStr, userId: 'user-bot-admin' })}` }
    })

    if (rot.statusCode !== 200) {
      throw new Error(`Failed to setup bot secret: ${rot.payload}`)
    }

    botSecret = JSON.parse(rot.payload).secret
    if (!botSecret) {
      throw new Error('Failed to parse bot secret from payload')
    }
  })

  after(async () => {
    if (app) await app.close()
  })

  const auth = (role, userId = 'user-123') => ({
    authorization: `Bearer ${generateTwitchToken({ role, channelId: channelIdStr, userId })}`
  })

  describe('Autorização e Acesso', () => {
    test('rejects unauthenticated request to config', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/announce/config' })
      assert.equal(res.statusCode, 401)
    })

    test('rejects viewer attempting to access broadcaster-only routes', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/announce/config',
        headers: auth('viewer'),
        payload: { enabled: true }
      })
      assert.equal(res.statusCode, 403)
    })

    test('rejects moderator attempting to rotate secrets', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/announce/secret/rotate',
        headers: auth('moderator')
      })
      assert.equal(res.statusCode, 403)
    })

    test('accepts moderator reading config', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/announce/config',
        headers: auth('moderator')
      })
      assert.equal(res.statusCode, 200)
      const json = JSON.parse(res.payload)
      assert.ok('enabled' in json)
    })
  })

  describe('Configuração e SSRF', () => {
    test('rejects private IPv4 webhook', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/announce/config',
        headers: auth('broadcaster'),
        payload: { webhook_url: 'https://192.168.1.1/hook', enabled: true }
      })
      assert.equal(res.statusCode, 400)
      assert.match(JSON.parse(res.payload).error.message, /destino privado/)
    })

    test('rejects loopback IPv6 webhook', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/announce/config',
        headers: auth('broadcaster'),
        payload: { webhook_url: 'https://[::1]/hook', enabled: true }
      })
      assert.equal(res.statusCode, 400)
    })

    test('rejects non-https protocols', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/announce/config',
        headers: auth('broadcaster'),
        payload: { webhook_url: 'http://example.com/hook', enabled: true }
      })
      assert.equal(res.statusCode, 400)
      assert.match(JSON.parse(res.payload).error.message, /só https/)
    })

    test('accepts valid public https webhook', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/announce/config',
        headers: auth('broadcaster'),
        payload: { webhook_url: 'https://example.com/webhook', enabled: true }
      })
      assert.equal(res.statusCode, 200)
    })
  })

  describe('Segredos e Rotação', () => {
    test('rotate returns plain secret only once and does not expose it in config', async () => {
      // Usamos um canal novo para este teste específico de rotação para não conflitar com o Rate Limit do setup
      const cStr = 'test-rot-' + Math.random().toString(36).slice(2)
      const { resolveChannel } = await import('../src/core/auth.js')
      await resolveChannel(cStr)

      const rot = await app.inject({
        method: 'POST',
        url: '/api/v1/announce/secret/rotate',
        headers: { authorization: `Bearer ${generateTwitchToken({ role: 'broadcaster', channelId: cStr, userId: 'user-rot-admin' })}` }
      })
      assert.equal(rot.statusCode, 200)
      const { secret } = JSON.parse(rot.payload)
      assert.ok(secret)
      assert.equal(secret.length, 64) // 32 bytes hex

      const cfg = await app.inject({
        method: 'GET',
        url: '/api/v1/announce/config',
        headers: { authorization: `Bearer ${generateTwitchToken({ role: 'broadcaster', channelId: cStr, userId: 'user-rot-admin' })}` }
      })
      assert.equal(cfg.statusCode, 200)
      assert.ok(!cfg.payload.includes(secret), 'secret must not leak in config')
    })

    test('enforces 1-hour rate limit on secret rotation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/announce/secret/rotate',
        headers: { authorization: `Bearer ${generateTwitchToken({ role: 'broadcaster', channelId: botChannelStr })}` }
      })
      assert.equal(res.statusCode, 429)
      assert.equal(JSON.parse(res.payload).error.code, 'ROTATE_TOO_SOON')
    })
  })

  describe('Templates de Eventos', () => {
    test('accepts template with exactly 300 characters', async () => {
      const longTpl = 'a'.repeat(300)
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/announce/events/guild.approved',
        headers: auth('broadcaster'),
        payload: { template: longTpl, enabled: true }
      })
      assert.equal(res.statusCode, 200)
    })

    test('rejects template with 301 characters', async () => {
      const tooLong = 'a'.repeat(301)
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/announce/events/guild.approved',
        headers: auth('broadcaster'),
        payload: { template: tooLong }
      })
      assert.equal(res.statusCode, 400)
      assert.equal(JSON.parse(res.payload).error.code, 'TEMPLATE_TOO_LONG')
    })

    test('rejects template containing unknown variables', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: '/api/v1/announce/events/guild.approved',
        headers: auth('broadcaster'),
        payload: { template: 'Bem vindo {jogador_inexistente}' }
      })
      assert.equal(res.statusCode, 400)
      assert.equal(JSON.parse(res.payload).error.code, 'UNKNOWN_VARIABLE')
    })
  })

  describe('Integridade HMAC (Bot)', () => {
    test('accepts valid bot signature with correct timestamp', async () => {
      const body = JSON.stringify({ minutes: 30, reason: 'raid' })
      const ts = Math.floor(Date.now() / 1000)
      const sig = generateBotSignature(body, botSecret, ts)

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/announce/mute',
        headers: {
          'x-guilds-channel-id': botChannelStr,
          'x-guilds-timestamp': String(ts),
          'x-guilds-signature': `v1=${sig}`,
          'content-type': 'application/json'
        },
        payload: body
      })
      assert.equal(res.statusCode, 204)
    })

    test('rejects tampered HMAC body', async () => {
      const body = JSON.stringify({ minutes: 30 })
      const ts = Math.floor(Date.now() / 1000)
      const sig = generateBotSignature(body, botSecret, ts)

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/announce/mute',
        headers: {
          'x-guilds-channel-id': botChannelStr,
          'x-guilds-timestamp': String(ts),
          'x-guilds-signature': `v1=${sig}`,
          'content-type': 'application/json'
        },
        payload: JSON.stringify({ minutes: 31 }) // Corpo alterado
      })
      assert.equal(res.statusCode, 401)
    })

    test('rejects bot request with expired timestamp', async () => {
      const body = JSON.stringify({ minutes: 10 })
      const ts = Math.floor(Date.now() / 1000) - 400 // 6 min atrás
      const sig = generateBotSignature(body, botSecret, ts)

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/announce/mute',
        headers: {
          'x-guilds-channel-id': botChannelStr,
          'x-guilds-timestamp': String(ts),
          'x-guilds-signature': `v1=${sig}`
        },
        payload: body
      })
      assert.equal(res.statusCode, 401)
    })

    test('rejects mute duration outside 1-240 minutes range', async () => {
      const body = JSON.stringify({ minutes: 241 })
      const ts = Math.floor(Date.now() / 1000)
      const sig = generateBotSignature(body, botSecret, ts)

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/announce/mute',
        headers: {
          'x-guilds-channel-id': botChannelStr,
          'x-guilds-timestamp': String(ts),
          'x-guilds-signature': `v1=${sig}`
        },
        payload: body
      })
      assert.equal(res.statusCode, 400)
      assert.equal(JSON.parse(res.payload).error.code, 'MUTE_RANGE')
    })
  })
})
