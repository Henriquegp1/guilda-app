import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  ROLES, ACTIONS, can, denyReason, roleChangeError, nextRole, prevRole,
} from '../src/modules/members/permissions.js'
import { COOLDOWN_H, cooldownUntil, exitCooldown, retryAfter } from '../src/modules/members/cooldown.js'

// ---------------------------------------------------------------------------
// A matriz da seção 4 de docs/fase-02-membros.md, transcrita como expectativa.
// 1 = ✔, 0 = ✘. Ações com alvo são testadas contra um alvo estritamente inferior.
// ---------------------------------------------------------------------------
const MATRIZ = {
  members_view:        { recruit: 1, member: 1, veteran: 1, officer: 1, leader: 1 },
  requests_view:       { recruit: 0, member: 0, veteran: 1, officer: 1, leader: 1 },
  leave:               { recruit: 1, member: 1, veteran: 1, officer: 1, leader: 0 },
  invite_create:       { recruit: 0, member: 0, veteran: 1, officer: 1, leader: 1 },
  invite_revoke_own:   { recruit: 0, member: 0, veteran: 1, officer: 1, leader: 1 },
  invite_revoke_any:   { recruit: 0, member: 0, veteran: 0, officer: 1, leader: 1 },
  request_approve:     { recruit: 0, member: 0, veteran: 0, officer: 1, leader: 1 },
  request_reject:      { recruit: 0, member: 0, veteran: 0, officer: 1, leader: 1 },
  kick:                { recruit: 0, member: 0, veteran: 0, officer: 1, leader: 1 },
  promote:             { recruit: 0, member: 0, veteran: 0, officer: 1, leader: 1 },
  demote:              { recruit: 0, member: 0, veteran: 0, officer: 1, leader: 1 },
  text_edit:           { recruit: 0, member: 0, veteran: 0, officer: 1, leader: 1 },
  join_mode_change:    { recruit: 0, member: 0, veteran: 0, officer: 0, leader: 1 },
  war_declare:         { recruit: 0, member: 0, veteran: 0, officer: 1, leader: 1 },
  leadership_transfer: { recruit: 0, member: 0, veteran: 0, officer: 0, leader: 1 },
  disband:             { recruit: 0, member: 0, veteran: 0, officer: 0, leader: 1 },
}

describe('matriz de permissões', () => {
  test('toda ação da matriz existe no módulo, e vice-versa', () => {
    assert.deepEqual(Object.keys(ACTIONS).sort(), Object.keys(MATRIZ).sort())
  })

  test('cada célula da matriz bate com can()', () => {
    for (const [acao, linha] of Object.entries(MATRIZ)) {
      for (const [cargo, esperado] of Object.entries(linha)) {
        const alvo = ACTIONS[acao].target ? 'recruit' : null
        assert.equal(can(cargo, acao, alvo), Boolean(esperado),
          `${acao} / ${cargo} deveria ser ${esperado ? '✔' : '✘'}`)
      }
    }
  })

  test('cargo desconhecido nunca pode nada', () => {
    for (const acao of Object.keys(ACTIONS)) {
      assert.equal(can('admin', acao, 'recruit'), false)
      assert.equal(can(undefined, acao, 'recruit'), false)
    }
  })

  test('negação por cargo devolve FORBIDDEN_ROLE', () => {
    assert.equal(denyReason('veteran', 'kick', 'recruit'), 'FORBIDDEN_ROLE')
    assert.equal(denyReason('officer', 'join_mode_change'), 'FORBIDDEN_ROLE')
  })

  // R7
  test('ninguém age sobre cargo igual ou superior', () => {
    for (const acao of ['kick', 'promote', 'demote']) {
      for (const ator of ROLES) {
        for (const alvo of ROLES) {
          const permitido = can(ator, acao, alvo)
          if (ROLES.indexOf(alvo) >= ROLES.indexOf(ator)) {
            assert.equal(permitido, false, `${ator} não pode ${acao} em ${alvo}`)
          }
        }
      }
    }
    assert.equal(denyReason('officer', 'kick', 'officer'), 'CANNOT_TARGET_HIGHER_ROLE')
    assert.equal(denyReason('officer', 'kick', 'leader'), 'CANNOT_TARGET_HIGHER_ROLE')
  })

  test('alvo que não é membro não vira negação por cargo', () => {
    assert.equal(denyReason('leader', 'kick', null), 'TARGET_NOT_MEMBER')
  })
})

describe('transição de cargo', () => {
  // R8
  test('ninguém promove ao próprio nível', () => {
    assert.equal(roleChangeError('officer', 'veteran', 'officer'), 'CANNOT_PROMOTE_TO_OWN_ROLE')
    assert.equal(roleChangeError('leader', 'officer', 'leader'), 'INVALID_ROLE_TRANSITION')
    assert.equal(roleChangeError('officer', 'member', 'veteran'), null)  // teto do oficial
    assert.equal(roleChangeError('leader', 'veteran', 'officer'), null)  // teto do líder
  })

  // R19: leader só por transferência
  test('leader nunca é alcançável por PATCH role', () => {
    for (const ator of ROLES) {
      for (const alvo of ROLES) {
        assert.equal(roleChangeError(ator, alvo, 'leader'), 'INVALID_ROLE_TRANSITION')
      }
    }
  })

  // R9
  test('a escada anda um degrau por vez', () => {
    assert.equal(roleChangeError('leader', 'recruit', 'officer'), 'INVALID_ROLE_TRANSITION')
    assert.equal(roleChangeError('leader', 'recruit', 'veteran'), 'INVALID_ROLE_TRANSITION')
    assert.equal(roleChangeError('leader', 'recruit', 'member'), null)
    assert.equal(roleChangeError('leader', 'veteran', 'member'), null)
  })

  test('cargo igual ao atual e cargo inexistente são transição inválida', () => {
    assert.equal(roleChangeError('leader', 'member', 'member'), 'INVALID_ROLE_TRANSITION')
    assert.equal(roleChangeError('leader', 'member', 'god'), 'INVALID_ROLE_TRANSITION')
    assert.equal(roleChangeError('leader', 'ghost', 'member'), 'INVALID_ROLE_TRANSITION')
  })

  // R10
  test('rebaixar recruta é inválido, não vira expulsão implícita', () => {
    assert.equal(prevRole('recruit'), null)
    for (const to of ROLES.filter(r => r !== 'member')) {
      assert.notEqual(roleChangeError('leader', 'recruit', to), null,
        `recruit -> ${to} deveria ser negado`)
    }
    assert.equal(roleChangeError('leader', 'recruit', 'member'), null)
  })

  // R7 aplicado à mudança de cargo
  test('oficial não rebaixa nem promove outro oficial', () => {
    assert.equal(roleChangeError('officer', 'officer', 'veteran'), 'CANNOT_TARGET_HIGHER_ROLE')
    assert.equal(roleChangeError('officer', 'leader', 'officer'), 'CANNOT_TARGET_HIGHER_ROLE')
  })

  test('quem não tem a permissão base é barrado antes da hierarquia', () => {
    assert.equal(roleChangeError('veteran', 'recruit', 'member'), 'FORBIDDEN_ROLE')
    assert.equal(roleChangeError('member', 'recruit', 'member'), 'FORBIDDEN_ROLE')
  })

  test('nextRole/prevRole cobrem as pontas da escada', () => {
    assert.equal(nextRole('leader'), null)
    assert.equal(nextRole('officer'), 'leader')
    assert.equal(prevRole('leader'), 'officer')
  })
})

// ---------------------------------------------------------------------------
// R12 — cooldown
// ---------------------------------------------------------------------------
describe('cooldown de reentrada', () => {
  const AGORA = new Date('2026-01-10T12:00:00Z')
  const h = (n) => new Date(AGORA.getTime() + n * 3600_000)
  const linha = (o) => ({ guild_id: 1, left_at: AGORA, cooldown_until: null, ...o })

  test('prazo gravado na saída depende do motivo', () => {
    assert.equal(+exitCooldown('left', AGORA), +h(COOLDOWN_H.left))
    assert.equal(+exitCooldown('kicked', AGORA), +h(COOLDOWN_H.kicked_same))
    assert.equal(exitCooldown('disbanded', AGORA), null)   // R21: dissolução não pune
    assert.equal(exitCooldown('purged', AGORA), null)
  })

  test('saída voluntária trava qualquer guilda do canal por 24h', () => {
    const rows = [linha({ reason: 'left', cooldown_until: h(24) })]
    assert.equal(+cooldownUntil(rows, 1, AGORA), +h(24))
    assert.equal(+cooldownUntil(rows, 99, AGORA), +h(24))
  })

  test('expulsão trava 72h na mesma guilda e 24h nas demais', () => {
    const rows = [linha({ reason: 'kicked', cooldown_until: h(72) })]
    assert.equal(+cooldownUntil(rows, 1, AGORA), +h(72))
    assert.equal(+cooldownUntil(rows, 2, AGORA), +h(24))
  })

  test('dissolução não gera cooldown', () => {
    assert.equal(cooldownUntil([linha({ reason: 'disbanded' })], 1, AGORA), null)
  })

  test('prazo vencido não trava', () => {
    const rows = [linha({ reason: 'kicked', left_at: h(-100), cooldown_until: h(-28) })]
    assert.equal(cooldownUntil(rows, 1, AGORA), null)
    assert.equal(cooldownUntil(rows, 2, AGORA), null)
  })

  test('vale o prazo mais longo entre várias saídas', () => {
    const rows = [
      linha({ guild_id: 7, reason: 'left', cooldown_until: h(4) }),
      linha({ guild_id: 9, reason: 'kicked', cooldown_until: h(70) }),
    ]
    assert.equal(+cooldownUntil(rows, 9, AGORA), +h(70))
    assert.equal(+cooldownUntil(rows, 7, AGORA), +h(24))   // expulsão da 9 respinga 24h
  })

  test('histórico vazio libera a entrada', () => {
    assert.equal(cooldownUntil([], 1, AGORA), null)
  })

  test('retry_after é em segundos e nunca negativo', () => {
    assert.equal(retryAfter(h(2), AGORA), 7200)
    assert.equal(retryAfter(h(-2), AGORA), 0)
  })
})

// ---------------------------------------------------------------------------
// Integração — só roda com Postgres. Sem DATABASE_URL a suíte inteira é pulada.
// ---------------------------------------------------------------------------
describe('fluxo de quadro (Postgres)', { skip: !process.env.DATABASE_URL }, () => {
  let pool, tx, build, app, channelId, guildId, token
  const sufixo = randomBytes(3).toString('hex')
  const U = { lider: `u-lider-${sufixo}`, dois: `u2-${sufixo}`, tres: `u3-${sufixo}` }

  const chamar = (method, url, { user, body } = {}) => app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, ...(user ? { 'x-actor-user-id': user } : {}) },
    ...(body ? { payload: body } : {}),
  })

  before(async () => {
    ;({ pool, tx } = await import('../src/core/db.js'))
    ;({ build } = await import('../src/server.js'))
    const { migrate } = await import('../src/core/migrate.js')
    await migrate(() => {})

    app = await build({ logger: false })
    await app.ready()

    await tx(async (c) => {
      const { rows: [ch] } = await c.query(
        'INSERT INTO channel (twitch_channel_id) VALUES ($1) RETURNING id', [`test-${sufixo}`])
      channelId = ch.id
      token = `ctk_test_${sufixo}`
      await c.query('INSERT INTO channel_token (token, channel_id) VALUES ($1, $2)', [token, channelId])

      // Nome/TAG fixos: o canal é novo a cada execução. Os campos de pagamento
      // satisfazem as CHECKs da fase 01 (010_guilds.sql).
      const { rows: [g] } = await c.query(
        `INSERT INTO guild (channel_id, name, tag, status, leader_user_id, creator_user_id,
                            member_limit, member_count, join_mode,
                            payment_status, bits_amount, bits_transaction_id)
         VALUES ($1, 'Void Walkers', 'VOID', 'active', $2, $2, 2, 1, 'open',
                 'paid', 500, $3) RETURNING id`,
        [channelId, U.lider, `tx-${sufixo}`])
      guildId = g.id
      await c.query(
        `INSERT INTO guild_member (guild_id, user_id, channel_id, role) VALUES ($1, $2, $3, 'leader')`,
        [guildId, U.lider, channelId])
    })
  })

  after(async () => {
    if (app) await app.close()
    if (channelId) await pool.query('DELETE FROM channel WHERE id = $1', [channelId])
    if (pool) await pool.end()
  })

  test('GET /me/guild responde a pergunta principal do painel', async () => {
    // Sem guilda é o estado normal de quase todo viewer: null, não 404.
    const semGuilda = await chamar('GET', '/me/guild', { user: U.tres })
    assert.equal(semGuilda.statusCode, 200)
    assert.equal(semGuilda.json(), null)

    const doLider = await chamar('GET', '/me/guild', { user: U.lider })
    assert.equal(doLider.statusCode, 200)
    const g = doLider.json()
    assert.equal(g.id, guildId)
    assert.equal(g.tag, 'VOID')
    assert.equal(g.my_role, 'leader', 'o painel esconde ações pelo cargo, precisa dele')
  })

  test('sem identidade concedida, /me/guild responde null em vez de exigir', async () => {
    const r = await chamar('GET', '/me/guild')   // sem x-actor-user-id
    assert.equal(r.statusCode, 200)
    assert.equal(r.json(), null)
  })

  test('entra em guilda aberta como recruta e member_count acompanha', async () => {
    const r = await chamar('POST', `/guilds/${guildId}/join`, { user: U.dois })
    assert.equal(r.statusCode, 201)
    assert.deepEqual(r.json(), { status: 'joined', role: 'recruit' })
    const { rows: [g] } = await pool.query('SELECT member_count FROM guild WHERE id = $1', [guildId])
    assert.equal(g.member_count, 2)
  })

  test('R1: quem já tem guilda no canal recebe ALREADY_IN_GUILD', async () => {
    const r = await chamar('POST', `/guilds/${guildId}/join`, { user: U.dois })
    assert.equal(r.json().error.code, 'ALREADY_IN_GUILD')
  })

  test('R3: guilda cheia recusa a entrada', async () => {
    const r = await chamar('POST', `/guilds/${guildId}/join`, { user: U.tres })
    assert.equal(r.statusCode, 409)
    assert.equal(r.json().error.code, 'GUILD_FULL')
  })

  test('R17: líder com outro membro não sai sem transferir', async () => {
    const r = await chamar('DELETE', `/guilds/${guildId}/members/me`, { user: U.lider })
    assert.equal(r.json().error.code, 'LEADER_MUST_TRANSFER')
  })

  test('R9: promoção pula-degrau é rejeitada', async () => {
    const r = await chamar('PATCH', `/guilds/${guildId}/members/${U.dois}/role`,
      { user: U.lider, body: { role: 'officer' } })
    assert.equal(r.json().error.code, 'INVALID_ROLE_TRANSITION')
  })

  test('R19: transferência deixa exatamente um líder', async () => {
    const r = await chamar('POST', `/guilds/${guildId}/leadership`,
      { user: U.lider, body: { to_user_id: U.dois } })
    assert.equal(r.statusCode, 200)
    const { rows } = await pool.query(
      "SELECT user_id FROM guild_member WHERE guild_id = $1 AND role = 'leader'", [guildId])
    assert.deepEqual(rows.map(r => r.user_id), [U.dois])
  })

  test('R12: expulsão grava histórico e bloqueia reentrada', async () => {
    const r = await chamar('DELETE', `/guilds/${guildId}/members/${U.lider}`, { user: U.dois })
    assert.equal(r.statusCode, 204)

    const { rows: [h] } = await pool.query(
      'SELECT * FROM guild_membership_history WHERE guild_id = $1 AND user_id = $2',
      [guildId, U.lider])
    assert.equal(h.reason, 'kicked')
    assert.equal(h.role_at_exit, 'officer')
    assert.equal(h.actor_user_id, U.dois)

    const volta = await chamar('POST', `/guilds/${guildId}/join`, { user: U.lider })
    assert.equal(volta.json().error.code, 'JOIN_COOLDOWN')
  })

  test('R22: cada entrada gerou exatamente um member.joined', async () => {
    const { rows } = await pool.query(
      "SELECT payload->>'user_id' AS u FROM guild_event WHERE guild_id = $1 AND type = 'member.joined'",
      [guildId])
    assert.deepEqual(rows.map(r => r.u), [U.dois])
  })

  test('R18: último membro sai, guilda vira suspended com guild.emptied', async () => {
    const r = await chamar('DELETE', `/guilds/${guildId}/members/me`, { user: U.dois })
    assert.equal(r.statusCode, 204)
    const { rows: [g] } = await pool.query(
      'SELECT status, member_count FROM guild WHERE id = $1', [guildId])
    assert.equal(g.status, 'suspended')
    assert.equal(g.member_count, 0)
    const { rows: ev } = await pool.query(
      "SELECT 1 FROM guild_event WHERE guild_id = $1 AND type = 'guild.emptied'", [guildId])
    assert.equal(ev.length, 1)
  })
})
