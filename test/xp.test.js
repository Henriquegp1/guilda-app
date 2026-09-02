import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  MAX_LEVEL, UNLOCKS, levelForXp, memberLimitForLevel,
  unlocksBetween, unlocksUpTo, xpForLevel, xpOfLevel, xpToNext,
} from '../src/modules/xp/curve.js'
import {
  DAILY_CAP, REDEEM, baseXp, dailyLimited, earn, publicTable, sourceLimited,
} from '../src/modules/xp/rules.js'

// ---------------------------------------------------------------------------
// Curva — os marcos da §5 do doc, transcritos como expectativa.
// ---------------------------------------------------------------------------
describe('curva de níveis (§5)', () => {
  const MARCOS = { 1: 0, 5: 5_000, 10: 22_500, 20: 95_000, 30: 217_500, 40: 390_000, 50: 612_500 }

  test('XP_total(N) = 250 · (N−1) · N nos marcos do doc', () => {
    for (const [nivel, xp] of Object.entries(MARCOS)) {
      assert.equal(xpForLevel(Number(nivel)), xp, `Nv.${nivel}`)
    }
  })

  test('XP do nível cresce 500 por degrau', () => {
    for (let n = 2; n <= MAX_LEVEL; n++) {
      assert.equal(xpOfLevel(n), 500 * (n - 1))
      assert.equal(xpForLevel(n) - xpForLevel(n - 1), xpOfLevel(n))
    }
  })

  test('ida e volta: levelForXp(xpForLevel(n)) === n', () => {
    for (let n = 1; n <= MAX_LEVEL; n++) assert.equal(levelForXp(xpForLevel(n)), n)
  })

  test('um XP a menos que o marco é o nível de baixo', () => {
    for (let n = 2; n <= MAX_LEVEL; n++) assert.equal(levelForXp(xpForLevel(n) - 1), n - 1)
  })

  test('22.500 é Nv.10 e 22.499 é Nv.9 (critério de aceite)', () => {
    assert.equal(levelForXp(22_500), 10)
    assert.equal(levelForXp(22_499), 9)
    assert.equal(memberLimitForLevel(levelForXp(22_500)), 6)
    assert.equal(memberLimitForLevel(levelForXp(22_499)), 4)
  })

  test('Nv.50 é teto: 700.000 XP continua Nv.50 com 15 vagas', () => {
    assert.equal(levelForXp(700_000), 50)
    assert.equal(levelForXp(10_000_000), 50)
    assert.equal(memberLimitForLevel(levelForXp(700_000)), 15)
    assert.equal(xpToNext(700_000), 0)
  })

  test('XP zero, negativo ou lixo nunca sai do Nv.1', () => {
    for (const xp of [0, -1, -999_999, null, undefined, NaN]) assert.equal(levelForXp(xp), 1)
  })

  test('xp_to_next é o que falta para o próximo marco', () => {
    assert.equal(xpToNext(0), 500)          // Nv.2 = 500
    assert.equal(xpToNext(22_499), 1)
    assert.equal(xpToNext(22_500), 5_000)   // Nv.11 = 27.500
  })
})

describe('vagas por nível (§6)', () => {
  const VAGAS = { 1: 2, 4: 2, 5: 4, 9: 4, 10: 6, 14: 6, 15: 8, 20: 10, 25: 11, 30: 12, 35: 13, 40: 14, 45: 15, 50: 15 }

  test('cada faixa da tabela', () => {
    for (const [nivel, vagas] of Object.entries(VAGAS)) {
      assert.equal(memberLimitForLevel(Number(nivel)), vagas, `Nv.${nivel}`)
    }
  })

  test('2 na fase 01 → 15 no Nv.50, sempre crescente', () => {
    assert.equal(memberLimitForLevel(1), 2)
    assert.equal(memberLimitForLevel(MAX_LEVEL), 15)
    for (let n = 2; n <= MAX_LEVEL; n++) {
      assert.ok(memberLimitForLevel(n) >= memberLimitForLevel(n - 1))
    }
  })

  test('nível fora da faixa é clampado, nunca extrapola as vagas', () => {
    assert.equal(memberLimitForLevel(0), 2)
    assert.equal(memberLimitForLevel(99), 15)
  })
})

describe('desbloqueios (§6)', () => {
  test('nenhuma chave se repete entre níveis', () => {
    const todas = Object.values(UNLOCKS).flat()
    assert.equal(new Set(todas).size, todas.length)
  })

  test('subir do 9 para o 10 desbloqueia o frame Bronze', () => {
    assert.deepEqual(unlocksBetween(9, 10), ['frame_bronze', 'color_special', 'banner_custom'])
  })

  test('queda de nível não desbloqueia nada (R11 cuida de não retirar)', () => {
    assert.deepEqual(unlocksBetween(10, 9), [])
    assert.deepEqual(unlocksBetween(10, 10), [])
  })

  test('Nv.12 é quem libera o histórico de XP', () => {
    assert.ok(!unlocksUpTo(11).includes('xp_history'))
    assert.ok(unlocksUpTo(12).includes('xp_history'))
  })

  test('o Nv.50 acumula tudo', () => {
    assert.equal(unlocksUpTo(50).length, Object.values(UNLOCKS).flat().length)
  })
})

// ---------------------------------------------------------------------------
// Tabela de ganho e tetos — §3 e §4.1.
// ---------------------------------------------------------------------------
describe('tabela de ganho (§3)', () => {
  test('subs: T1 50, T2 100, T3 150', () => {
    assert.equal(baseXp('channel.subscribe', { tier: 1000 }), 50)
    assert.equal(baseXp('channel.subscribe', { tier: '2000' }), 100)
    assert.equal(baseXp('channel.subscribe', { tier: '3000' }), 150)
    assert.equal(baseXp('channel.subscribe', {}), 50)          // Prime chega sem tier
  })

  test('o presenteado com gift sub recebe 0 (critério de aceite)', () => {
    assert.equal(baseXp('channel.subscribe', { tier: 1000, is_gift: true }), 0)
  })

  test('gift vale 40 por unidade, para o presenteador', () => {
    assert.equal(baseXp('channel.subscription.gift', { total: 1 }), 40)
    assert.equal(baseXp('channel.subscription.gift', { total: 5 }), 200)
    assert.equal(baseXp('channel.subscription.gift', {}), 40)
  })

  test('bits convertem 1 XP a cada 10, sem fração', () => {
    assert.equal(baseXp('channel.cheer', { bits: 100 }), 10)
    assert.equal(baseXp('channel.cheer', { bits: 99 }), 9)
    assert.equal(baseXp('channel.cheer', { bits: 0 }), 0)
  })

  test('resgate só vale com a flag guild_xp do streamer', () => {
    assert.equal(baseXp(REDEEM, { guild_xp: true }), 5)
    assert.equal(baseXp(REDEEM, {}), 0)
  })

  test('tipo fora da tabela não vale XP', () => {
    assert.equal(baseXp('member.joined', {}), 0)
    assert.equal(baseXp('event.placement', { rank: 1 }), 0)
  })

  test('a tabela pública não expõe nada além de regra e teto', () => {
    const t = publicTable()
    assert.equal(t.cap_daily, 200)
    assert.equal(t.rules.length, 9)
    assert.ok(t.rules.every(r => 'type' in r && 'xp' in r && 'cap' in r))
  })
})

describe('limites próprios de cada fonte (§3)', () => {
  test('3 h de live rendem 18 ticks; a 4ª hora rende 0', () => {
    assert.equal(sourceLimited('watch.tick', 2, { count: 17 }), 2)
    assert.equal(sourceLimited('watch.tick', 2, { count: 18 }), 0)
  })

  test('1.500 Bits em um dia creditam 100, não 150', () => {
    assert.equal(sourceLimited('channel.cheer', 150, { xp: 0 }), 100)
    assert.equal(sourceLimited('channel.cheer', 10, { xp: 95 }), 5)
    assert.equal(sourceLimited('channel.cheer', 10, { xp: 100 }), 0)
  })

  test('gift corta por unidade, não por XP solto', () => {
    assert.equal(sourceLimited('channel.subscription.gift', 200, { xp: 320 }), 80)  // 8 usadas, 2 sobram
    assert.equal(sourceLimited('channel.subscription.gift', 200, { xp: 400 }), 0)
  })

  test('evento: 4 participações e 2 vitórias por dia', () => {
    assert.equal(sourceLimited('event.participate', 5, { count: 3 }), 5)
    assert.equal(sourceLimited('event.participate', 5, { count: 4 }), 0)
    assert.equal(sourceLimited('event.win', 10, { count: 1 }), 10)
    assert.equal(sourceLimited('event.win', 10, { count: 2 }), 0)
  })

  test('follow é bônus único: a segunda vez vale 0', () => {
    assert.equal(sourceLimited('channel.follow', 25, { count: 0 }), 25)
    assert.equal(sourceLimited('channel.follow', 25, { count: 1 }), 0)
  })

  test('sub e gift não têm limite de contagem própria', () => {
    assert.equal(sourceLimited('channel.subscribe', 150, { count: 9, xp: 900 }), 150)
  })
})

describe('teto diário de 200 (§4.1)', () => {
  test('o evento que estoura o teto entra cortado e marcado', () => {
    const r = earn('channel.subscribe', { tier: 1000 }, { xpToday: 180 })
    assert.deepEqual({ ...r }, { amount: 20, base: 50, capped: true, reason: 'channel.subscribe' })
  })

  test('no teto exato o evento seguinte vale 0 e continua marcado', () => {
    const r = earn('channel.subscribe', { tier: 2000 }, { xpToday: DAILY_CAP })
    assert.equal(r.amount, 0)
    assert.equal(r.capped, true)
  })

  test('300 XP de fontes válidas em um dia viram 200 (critério de aceite)', () => {
    let dia = 0
    const fontes = [
      ['channel.subscribe', { tier: 3000 }],   // 150
      ['channel.subscribe', { tier: 1000 }],   // 50 → fecha os 200
      ['channel.subscription.gift', { total: 2 }],  // 80 → excedente descartado
    ]
    for (const [type, payload] of fontes) {
      dia += earn(type, payload, { xpToday: dia }).amount
    }
    assert.equal(dia, DAILY_CAP)
  })

  test('excedente não vira crédito: o dia seguinte começa em 0', () => {
    assert.equal(earn('channel.cheer', { bits: 1000 }, { xpToday: 0 }).amount, 100)
  })

  test('evento abaixo do teto e do limite próprio não é marcado', () => {
    const r = earn('event.win', { }, { xpToday: 10, bySource: { 'event.win': { count: 0 } } })
    assert.deepEqual({ ...r }, { amount: 10, base: 10, capped: false, reason: 'event.win' })
  })

  test('dailyLimited nunca devolve negativo', () => {
    assert.equal(dailyLimited(50, 500), 0)
    assert.equal(dailyLimited(0, 0), 0)
  })

  test('o perfil "ativo sem gastar" da §3 fecha em 106 XP', () => {
    const dia =
      18 * 2 +                                                   // watch (2 XP)
      4 * 5 +                                                    // event.participate
      2 * 10 +                                                   // event.win
      3 * 5 +                                                    // resgate
      15 * 1                                                     // chat (15 msgs)
    assert.equal(dia, 106)
  })
})

// ---------------------------------------------------------------------------
// Integração — só roda com Postgres migrado.
// `DATABASE_URL=... npm run migrate && DATABASE_URL=... npm test`
// ---------------------------------------------------------------------------
describe('ledger e agregados (Postgres)', { skip: !process.env.DATABASE_URL }, () => {
  let db, emit, xp, channelId, guildId
  const sufixo = randomBytes(3).toString('hex')
  const U = { sub: `u-sub-${sufixo}`, bits: `u-bits-${sufixo}`, fora: `u-fora-${sufixo}` }

  /** Emite o guild_event e processa na mesma transação, como faz o handler. */
  const fire = (type, payload, userId, externalId = null) => db.tx(async (c) => {
    const ev = await emit(c, {
      channelId, type, payload, actorUserId: userId, externalId,
    })
    if (!ev) return null   // webhook reenviado: o core já barrou
    return xp.applyEvent(c, {
      ...ev, channel_id: channelId, guild_id: null, type, payload, actor_user_id: userId,
    })
  })

  const guild = async () => (await db.query('SELECT * FROM guild WHERE id = $1', [guildId])).rows[0]
  const setXp = (valor) => db.query('UPDATE guild SET xp = $2 WHERE id = $1', [guildId, valor])
  const recompute = () => db.tx(async (c) => xp.recomputeLevel(c, await guild()))
  const levelUps = async () => (await db.query(
    "SELECT payload FROM guild_event WHERE guild_id = $1 AND type = 'guild.level_up' ORDER BY id",
    [guildId])).rows.map(r => r.payload)

  before(async () => {
    db = await import('../src/core/db.js')
    ;({ emit } = await import('../src/core/events.js'))
    xp = await import('../src/modules/xp/index.js')
    const { migrate } = await import('../src/core/migrate.js')
    await migrate(() => {})

    const { rows: [ch] } = await db.query(
      'INSERT INTO channel (twitch_channel_id) VALUES ($1) RETURNING id', [`test-xp-${sufixo}`])
    channelId = ch.id
    const { rows: [g] } = await db.query(
      `INSERT INTO guild (channel_id, name, tag, status, leader_user_id, creator_user_id,
                          member_count, payment_status, bits_amount, bits_transaction_id)
       VALUES ($1, 'Xp Testers', 'XPT', 'active', $2, $2, 2, 'paid', 500, $3) RETURNING id`,
      [channelId, U.sub, `tx-xp-${sufixo}`])
    guildId = g.id
    for (const [user, role] of [[U.sub, 'leader'], [U.bits, 'member']]) {
      await db.query(
        'INSERT INTO guild_member (guild_id, user_id, channel_id, role) VALUES ($1, $2, $3, $4)',
        [guildId, user, channelId, role])
    }
  })

  after(async () => {
    if (channelId) await db.query('DELETE FROM channel WHERE id = $1', [channelId])
    if (db) await db.pool.end()
  })

  test('R1: sub T1 credita 50 na guilda do membro', async () => {
    const e = await fire('channel.subscribe', { tier: 1000 }, U.sub, `sub-${sufixo}`)
    assert.equal(e.amount, 50)
    assert.equal(e.guild_id, guildId)
    assert.equal((await guild()).xp, 50)
  })

  test('R3: o mesmo external_id reenviado não credita de novo', async () => {
    assert.equal(await fire('channel.subscribe', { tier: 1000 }, U.sub, `sub-${sufixo}`), null)
    assert.equal((await guild()).xp, 50)
  })

  test('R4: evento de quem não tem guilda entra no ledger com amount 0', async () => {
    const e = await fire('channel.cheer', { bits: 500 }, U.fora, `cheer-fora-${sufixo}`)
    assert.equal(e.amount, 0)
    assert.equal(e.guild_id, null)
  })

  test('teto de bits: 1.500 em um dia dão 100 XP, e o próximo cheer dá 0', async () => {
    const a = await fire('channel.cheer', { bits: 1500 }, U.bits, `cheer1-${sufixo}`)
    assert.equal(a.amount, 100)
    assert.equal(a.capped, true)
    const b = await fire('channel.cheer', { bits: 100 }, U.bits, `cheer2-${sufixo}`)
    assert.equal(b.amount, 0)
  })

  test('R5: o teto diário fecha em 200 por (canal, usuário, dia)', async () => {
    await fire('channel.subscription.gift', { total: 3 }, U.bits, `gift-${sufixo}`)   // +120 → 220?
    const { rows: [d] } = await db.query(
      'SELECT xp_granted FROM member_xp_daily WHERE channel_id = $1 AND user_id = $2',
      [channelId, U.bits])
    assert.equal(d.xp_granted, 200)
    const extra = await fire('channel.subscribe', { tier: 3000 }, U.bits, `sub2-${sufixo}`)
    assert.equal(extra.amount, 0)
  })

  test('R12: estorno é lançamento negativo, nunca DELETE', async () => {
    const antes = (await guild()).xp
    const e = await fire('channel.subscription.end', {}, U.sub, `end-${sufixo}`)
    assert.equal(e.amount, -50)
    assert.equal(e.reason, 'xp_reversal')
    assert.equal((await guild()).xp, antes - 50)
    const { rows } = await db.query(
      'SELECT count(*)::int AS n FROM guild_xp_entry WHERE event_id IS NOT NULL AND guild_id = $1',
      [guildId])
    assert.ok(rows[0].n >= 3)   // nada foi apagado
  })

  test('R9/R16: subir para o Nv.10 muda vagas e emite guild.level_up uma vez', async () => {
    await setXp(22_500)
    await recompute()
    const g = await guild()
    assert.equal(g.level, 10)
    assert.equal(g.member_limit, 6)
    const eventos = await levelUps()
    assert.equal(eventos.length, 1)
    assert.deepEqual(eventos[0], { from: 1, to: 10, unlocks: unlocksBetween(1, 10) })
    const { rows } = await db.query(
      "SELECT level_earned FROM guild_unlock WHERE guild_id = $1 AND unlock_key = 'frame_bronze'",
      [guildId])
    assert.equal(rows[0].level_earned, 10)
  })

  test('R9/R11: queda cruzando o marco desce nível e vagas, sem evento e sem tirar cosmético', async () => {
    await setXp(22_499)
    await recompute()
    const g = await guild()
    assert.equal(g.level, 9)
    assert.equal(g.member_limit, 4)
    assert.equal((await levelUps()).length, 1)   // queda não emite (R16)
    const { rowCount } = await db.query(
      "SELECT 1 FROM guild_unlock WHERE guild_id = $1 AND unlock_key = 'frame_bronze'", [guildId])
    assert.equal(rowCount, 1)
  })

  test('R10: limite abaixo da lotação põe a guilda em overflow, sem expulsar ninguém', async () => {
    await db.query('UPDATE guild SET member_count = 11 WHERE id = $1', [guildId])
    await recompute()
    assert.equal((await guild()).status, 'overflow')
    const { rows: [m] } = await db.query(
      'SELECT count(*)::int AS n FROM guild_member WHERE guild_id = $1', [guildId])
    assert.equal(m.n, 2)   // ninguém saiu

    await setXp(22_500)    // volta ao Nv.10: 11 membros NÃO cabem em 10
    await recompute()
    assert.equal((await guild()).status, 'overflow')
    await db.query('UPDATE guild SET member_count = 2 WHERE id = $1', [guildId])
    await recompute()
    assert.equal((await guild()).status, 'active')
  })

  test('R17: snapshot do dia é imutável', async () => {
    const a = await xp.snapshotDaily()
    assert.ok(a.guilds >= 1)
    await setXp(30_000)
    await xp.snapshotDaily()    // a segunda passada não reescreve nada
    const { rows } = await db.query(
      'SELECT xp_total FROM guild_level_snapshot WHERE guild_id = $1', [guildId])
    assert.equal(Number(rows[0].xp_total), 22_500)
    await setXp(22_500)
  })

  test('R17: reconcileXp acusa guild.xp divergente do ledger', async () => {
    const divergentes = await xp.reconcileXp({ log: { warn () {} } })
    const nossa = divergentes.find(d => String(d.guild_id) === String(guildId))
    assert.ok(nossa, 'o setXp dos testes acima é exatamente o drift que o job existe para achar')
    assert.equal(nossa.cached, 22_500)

    // Com o cache batendo o ledger, a guilda some do relatório.
    const { rows: [l] } = await db.query(
      'SELECT coalesce(sum(amount), 0)::int AS total FROM guild_xp_entry WHERE guild_id = $1', [guildId])
    await setXp(l.total)
    const limpo = await xp.reconcileXp({ log: { warn () {} } })
    assert.equal(limpo.find(d => String(d.guild_id) === String(guildId)), undefined)
  })

  test('o handler pega eventos ainda não lançados e é idempotente', async () => {
    await db.tx(c => emit(c, {
      channelId, guildId, type: 'event.win', payload: { user_id: U.sub, event_id: 'p1' },
      actorUserId: U.sub, externalId: `win-${sufixo}`,
    }))
    const um = await xp.ingestXpOnce({ log: { error () {} } })
    assert.ok(um.posted >= 1)
    const dois = await xp.ingestXpOnce({ log: { error () {} } })
    assert.equal(dois.posted, 0)
  })
})
