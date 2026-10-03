import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'

// Integração — só roda com Postgres (DATABASE_URL). Cobre POST /mod/guilds:
// criação gratuita pelo streamer, sem passar pelo fluxo de Bits.
describe('criação gratuita pela moderação (Postgres)', { skip: !process.env.DATABASE_URL }, () => {
  const SECRET = Buffer.from('segredo-de-teste-32-bytes-aqui!!').toString('base64')
  const sufixo = randomBytes(3).toString('hex')
  const TWITCH_CHANNEL = `free-${sufixo}`
  let pool, app

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const jwt = (role, userId = '9000') => {
    const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
      exp: Math.floor(Date.now() / 1000) + 300, channel_id: TWITCH_CHANNEL, user_id: userId, role,
    })}`
    return `${body}.${createHmac('sha256', Buffer.from(SECRET, 'base64')).update(body).digest('base64url')}`
  }
  const criar = (role, body) => app.inject({
    method: 'POST',
    url: '/api/v1/mod/guilds',
    headers: { authorization: `Bearer ${jwt(role)}` },
    payload: body,
  })
  const ok = { name: 'Gratis Um', tag: 'GR1', leader_user_id: '1001', reason: 'sorteio' }

  before(async () => {
    process.env.TWITCH_EXT_SECRET = SECRET
    ;({ pool } = await import('../src/core/db.js'))
    const { build } = await import('../src/server.js')
    const { migrate } = await import('../src/core/migrate.js')
    await migrate(() => {})
    app = await build({ logger: false })
    await app.ready()
  })

  after(async () => {
    await pool.query('DELETE FROM channel WHERE twitch_channel_id = $1', [TWITCH_CHANNEL])
    await app.close()
    await pool.end()
  })

  test('streamer cria: nasce ativa, paga, com líder, sem Bits e com auditoria', async () => {
    const res = await criar('broadcaster', ok)
    assert.equal(res.statusCode, 201, res.body)
    const g = res.json()
    assert.equal(g.status, 'active')
    assert.equal(g.payment_status, 'paid')
    assert.equal(g.bits_amount, 0)
    assert.match(g.bits_transaction_id, /^free:/)
    assert.equal(g.leader_user_id, '1001')

    const { rows: [m] } = await pool.query(
      'SELECT role FROM guild_member WHERE guild_id = $1 AND user_id = $2', [g.id, '1001'])
    assert.equal(m.role, 'lider')
    const { rows: [a] } = await pool.query(
      `SELECT actor_role, after FROM audit_log WHERE target = $1 AND action = 'guild.create_free'`, [`guild:${g.id}`])
    assert.equal(a.actor_role, 'broadcaster')
    assert.equal(a.after.reason, 'sorteio')
    const { rows: ev } = await pool.query(
      `SELECT type FROM guild_event WHERE guild_id = $1 ORDER BY id`, [g.id])
    assert.deepEqual(ev.map((e) => e.type), ['guild.created', 'guild.approved'])
  })

  test('moderador comum não pode (só o streamer)', async () => {
    const res = await criar('moderator', { ...ok, name: 'Gratis Dois', tag: 'GR2', leader_user_id: '1002' })
    assert.equal(res.statusCode, 403)
  })

  test('viewer não pode', async () => {
    const res = await criar('viewer', { ...ok, name: 'Gratis Tres', tag: 'GR3', leader_user_id: '1003' })
    assert.equal(res.statusCode, 403)
  })

  test('valida entrada: motivo, ID do líder, nome e TAG', async () => {
    for (const ruim of [
      { ...ok, name: 'Val A', tag: 'VA', leader_user_id: '2001', reason: '' },
      { ...ok, name: 'Val B', tag: 'VB', leader_user_id: 'abc', reason: 'x' },
      { ...ok, name: 'a', tag: 'VC', leader_user_id: '2003', reason: 'x' },
      { ...ok, name: 'Val D', tag: 'x!', leader_user_id: '2004', reason: 'x' },
    ]) {
      const res = await criar('broadcaster', ruim)
      assert.equal(res.statusCode, 400, JSON.stringify(ruim))
    }
  })

  test('conflitos: nome, TAG e líder que já tem guilda → 409 sem deixar lixo', async () => {
    const nome = await criar('broadcaster', { ...ok, tag: 'GR9', leader_user_id: '3001' })
    assert.equal(nome.statusCode, 409)
    assert.equal(nome.json().error?.code ?? nome.json().code, 'GUILD_NAME_TAKEN')
    const tag = await criar('broadcaster', { ...ok, name: 'Gratis Tag', leader_user_id: '3002' })
    assert.equal(tag.statusCode, 409)
    const lider = await criar('broadcaster', { ...ok, name: 'Gratis Lider', tag: 'GR8' })
    assert.equal(lider.statusCode, 409)
    const { rows: [n] } = await pool.query(
      `SELECT count(*)::int AS n FROM guild g JOIN channel c ON c.id = g.channel_id
        WHERE c.twitch_channel_id = $1`, [TWITCH_CHANNEL])
    assert.equal(n.n, 1)
  })
})
