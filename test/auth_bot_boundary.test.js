import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'

describe('Segurança: Fronteira de Autenticação do Bot', { skip: !process.env.DATABASE_URL }, () => {
  let db, build, app, channelId, token

  const sufixo = randomBytes(3).toString('hex')

  before(async () => {
    db = await import('../src/core/db.js')
    ;({ build } = await import('../src/server.js'))
    const { migrate } = await import('../src/core/migrate.js')
    await migrate(() => {})

    app = await build({ logger: false })
    await app.ready()

    // Cria um canal de teste e um token de bot
    const { rows: [ch] } = await db.query(
      'INSERT INTO channel (twitch_channel_id) VALUES ($1) RETURNING id', [`bot-boundary-${sufixo}`])
    channelId = ch.id
    token = `ctk_bot_${sufixo}`
    await db.query('INSERT INTO channel_token (token, channel_id) VALUES ($1, $2)', [token, channelId])
  })

  after(async () => {
    if (app) await app.close()
    if (channelId) await db.query('DELETE FROM channel WHERE id = $1', [channelId])
    if (db) await db.pool.end()
  })

  test('token de bot autenticado NÃO consegue acessar rotas de moderação (requireModerator)', async () => {
    // Tenta acessar a fila de moderação usando o token do bot e forjando o header de usuário
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/mod/identity/queue',
      headers: {
        authorization: `Bearer ${token}`,
        'x-actor-user-id': 'streamer-id-forjado'
      }
    })

    assert.equal(res.statusCode, 403)
    assert.equal(res.json().error.code, 'FORBIDDEN')
    assert.equal(res.json().error.message, 'requer broadcaster ou moderator')
  })

  test('token de bot autenticado NÃO consegue acessar rotas de broadcaster (requireBroadcaster)', async () => {
    // Tenta mutar anúncios (rota que exige broadcaster)
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/announce/mute',
      headers: {
        authorization: `Bearer ${token}`,
        'x-actor-user-id': 'streamer-id-forjado'
      },
      payload: { minutes: 10, reason: 'teste' }
    })

    assert.equal(res.statusCode, 403)
    assert.equal(res.json().error.code, 'FORBIDDEN')
    assert.equal(res.json().error.message, 'requer broadcaster')
  })

  test('token de bot autenticado não abre role de moderador mesmo com X-Actor-User-Id de qualquer valor', async () => {
     // Verifica a listagem de auditoria (exige moderador)
     const res = await app.inject({
      method: 'GET',
      url: '/api/v1/mod/audit-log',
      headers: {
        authorization: `Bearer ${token}`,
        'x-actor-user-id': '1' // tentando personificar o broadcaster
      }
    })

    assert.equal(res.statusCode, 403)
  })
})
