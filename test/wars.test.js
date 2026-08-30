import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import {
  FORMATS, FORMAT_KEYS, OFFLINE_GRACE_MS, OPEN_STATES, SETTLE_GRACE_MS, TRANSITIONS, WAR_STATES,
  assertTransition, canTransition, challengeExpiresAt, isContestable, isFormat, isOfflineFor,
  isTerminal, nextUtcMidnight, settleDueAt, specialWindowError, warWindow,
} from '../src/modules/wars/machine.js'
import {
  DAILY_CAP, MONETARY_TYPES, REDEEM, REPEAT_MULTIPLIER, ROSTER_MAX, ROSTER_MIN,
  WEEKLY_FULL_WARS, WP_TABLE, WP_TYPES,
  grantWp, prestigeAwards, prestigeMultiplier, publicWpTable, resolveWar, rosterSize,
  rosterTooSmall, utcDay, wpFor,
} from '../src/modules/wars/scoring.js'
import {
  BOARD_LIMIT_BYTES, MAX_WARS_PER_BOARD, boardBytes, buildBoard, buildEnded,
} from '../src/modules/wars/board.js'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const ts = (iso) => new Date(iso)

// ---------------------------------------------------------------------------
// Formatos (§5) — a tabela fechada do doc transcrita como expectativa.
// ---------------------------------------------------------------------------
describe('formatos de guerra (§5)', () => {
  test('os três formatos, com duração, piso e Prestígio fechados', () => {
    assert.deepEqual(FORMAT_KEYS, ['skirmish', 'campaign', 'special'])

    assert.equal(FORMATS.skirmish.durationMs, 6 * HOUR)
    assert.equal(FORMATS.skirmish.minPoints, 200)
    assert.deepEqual(FORMATS.skirmish.prestige, { winner: 150, loser: 40, draw: 80 })

    assert.equal(FORMATS.campaign.durationMs, 7 * DAY)
    assert.equal(FORMATS.campaign.minPoints, 800)
    assert.deepEqual(FORMATS.campaign.prestige, { winner: 500, loser: 120, draw: 250 })

    assert.deepEqual(FORMATS.special.windowDays, { min: 1, max: 14 })
    assert.equal(FORMATS.special.minPoints, 1500)
    assert.deepEqual(FORMATS.special.prestige, { winner: 900, loser: 200, draw: 450 })
  })

  test('só special aceita stake de território; só skirmish morre com a live', () => {
    assert.equal(FORMATS.special.allowsStake, true)
    assert.equal(FORMATS.skirmish.allowsStake, false)
    assert.equal(FORMATS.campaign.allowsStake, false)
    assert.equal(FORMATS.skirmish.endsOnOffline, true)
    assert.equal(FORMATS.campaign.endsOnOffline, false)
    assert.equal(FORMATS.special.endsOnOffline, false)
  })

  test('formato desconhecido é recusado', () => {
    for (const f of ['duel', '', null, 'SKIRMISH', 'constructor']) assert.equal(isFormat(f), false)
  })

  test('R4 — janela de resposta: skirmish 2 h, campaign e special 24 h', () => {
    const at = ts('2026-03-01T10:00:00Z')
    assert.equal(+challengeExpiresAt('skirmish', at), +at + 2 * HOUR)
    assert.equal(+challengeExpiresAt('campaign', at), +at + 24 * HOUR)
    assert.equal(+challengeExpiresAt('special', at), +at + 24 * HOUR)
  })

  test('início e fim de cada formato', () => {
    const accepted = ts('2026-03-01T22:30:00Z')

    const sk = warWindow('skirmish', { acceptedAt: accepted })
    assert.equal(+sk.startsAt, +accepted + 5 * MIN)
    assert.equal(+sk.endsAt, +sk.startsAt + 6 * HOUR)

    const cp = warWindow('campaign', { acceptedAt: accepted })
    assert.equal(cp.startsAt.toISOString(), '2026-03-02T00:00:00.000Z')
    assert.equal(+cp.endsAt, +cp.startsAt + 7 * DAY)

    const sp = warWindow('special', {
      opensAt: ts('2026-03-05T00:00:00Z'), closesAt: ts('2026-03-08T00:00:00Z'),
    })
    assert.equal(sp.startsAt.toISOString(), '2026-03-05T00:00:00.000Z')
    assert.equal(sp.endsAt.toISOString(), '2026-03-08T00:00:00.000Z')
  })

  test('meia-noite UTC seguinte não escorrega no fim do mês', () => {
    assert.equal(nextUtcMidnight(ts('2026-12-31T23:59:59Z')).toISOString(),
      '2027-01-01T00:00:00.000Z')
    assert.equal(nextUtcMidnight(ts('2026-03-01T00:00:00Z')).toISOString(),
      '2026-03-02T00:00:00.000Z')
  })

  test('janela do special: 1 a 14 dias, nada fora disso', () => {
    const open = ts('2026-03-05T00:00:00Z')
    assert.equal(specialWindowError(open, new Date(+open + DAY)), null)
    assert.equal(specialWindowError(open, new Date(+open + 14 * DAY)), null)
    assert.equal(specialWindowError(open, new Date(+open + 15 * DAY)), 'WAR_WINDOW_INVALID')
    assert.equal(specialWindowError(open, new Date(+open + HOUR)), 'WAR_WINDOW_INVALID')
    assert.equal(specialWindowError(open, new Date(+open - DAY)), 'WAR_WINDOW_INVALID')
    assert.equal(specialWindowError('não é data', open), 'WAR_WINDOW_INVALID')
  })
})

// ---------------------------------------------------------------------------
// Máquina de estados (§4) — toda transição fora da tabela é recusada.
// ---------------------------------------------------------------------------
describe('máquina de estados da guerra (§4)', () => {
  test('os nove estados do doc, nem um a mais', () => {
    assert.deepEqual([...WAR_STATES].sort(), [
      'accepted', 'active', 'cancelled', 'declined', 'ended', 'expired',
      'no_contest', 'pending', 'settled',
    ])
  })

  test('as transições válidas são exatamente as do diagrama', () => {
    assert.deepEqual(TRANSITIONS.pending, ['accepted', 'declined', 'expired', 'cancelled'])
    assert.deepEqual(TRANSITIONS.accepted, ['active', 'cancelled'])
    assert.deepEqual(TRANSITIONS.active, ['ended', 'cancelled'])
    assert.deepEqual(TRANSITIONS.ended, ['settled', 'no_contest', 'cancelled'])
  })

  test('estados terminais não vão a lugar nenhum', () => {
    for (const s of ['declined', 'expired', 'settled', 'no_contest', 'cancelled']) {
      assert.equal(isTerminal(s), true, s)
      for (const to of WAR_STATES) assert.equal(canTransition(s, to), false, `${s} -> ${to}`)
    }
    for (const s of OPEN_STATES) assert.equal(isTerminal(s), false, s)
  })

  test('todo par (de, para) fora da tabela é recusado — inclusive os atalhos óbvios', () => {
    for (const from of WAR_STATES) {
      for (const to of WAR_STATES) {
        const permitido = TRANSITIONS[from].includes(to)
        assert.equal(canTransition(from, to), permitido, `${from} -> ${to}`)
        if (permitido) {
          assert.equal(assertTransition(from, to), to)
        } else {
          assert.throws(() => assertTransition(from, to), (err) => {
            assert.equal(err.status, 409)
            assert.equal(err.code, 'WAR_INVALID_TRANSITION')
            assert.deepEqual(err.data, { from, to })
            return true
          }, `${from} -> ${to} deveria ser recusada`)
        }
      }
    }
  })

  test('atalhos que pulariam roster travado ou contestação', () => {
    for (const [from, to] of [
      ['pending', 'active'], ['pending', 'settled'], ['accepted', 'ended'],
      ['active', 'settled'], ['active', 'no_contest'], ['ended', 'active'],
      ['settled', 'cancelled'], ['expired', 'accepted'], ['declined', 'active'],
    ]) assert.equal(canTransition(from, to), false, `${from} -> ${to}`)
  })

  test('estado inventado nunca transiciona', () => {
    assert.equal(canTransition('paused', 'active'), false)
    assert.equal(canTransition('active', 'paused'), false)
    assert.equal(canTransition('toString', 'active'), false)
  })

  test('R15 — contestação de 10 min depois de ended', () => {
    const ended = ts('2026-03-01T12:00:00Z')
    assert.equal(SETTLE_GRACE_MS, 10 * MIN)
    assert.equal(+settleDueAt(ended), +ended + 10 * MIN)
    assert.equal(isContestable(ended, new Date(+ended + 9 * MIN)), true)
    assert.equal(isContestable(ended, new Date(+ended + 10 * MIN)), false)
  })

  test('§7 — skirmish morre 15 min depois de a live cair', () => {
    const now = ts('2026-03-01T12:00:00Z')
    assert.equal(OFFLINE_GRACE_MS, 15 * MIN)
    assert.equal(isOfflineFor(new Date(+now - 14 * MIN), now), false)
    assert.equal(isOfflineFor(new Date(+now - 16 * MIN), now), true)
    assert.equal(isOfflineFor(null, now), true)          // nunca houve sinal de live
  })
})

// ---------------------------------------------------------------------------
// Tabela de WP (§6). O zero das fontes monetárias é o item que não pode falhar.
// ---------------------------------------------------------------------------
describe('pontos de guerra (§6)', () => {
  test('cada linha da tabela vale exatamente o WP declarado', () => {
    assert.equal(wpFor('daily_checkin'), 30)
    assert.equal(wpFor('watch.tick'), 1)
    assert.equal(wpFor('chat_message'), 1)
    assert.equal(wpFor(REDEEM, { war_action: true }), 10)
    assert.equal(wpFor('event.win'), 15)
    assert.equal(wpFor('raid_participation'), 25)
    assert.equal(wpFor('rpg_duel_win'), 20)
    assert.equal(wpFor('achievement.unlocked'), 40)
  })

  test('os tetos por membro/dia de cada fonte', () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(WP_TABLE).map(([t, r]) => [t, r.cap])),
      {
        daily_checkin: 30,
        'watch.tick': 60,
        chat_message: 30,
        [REDEEM]: 50,
        'event.win': 75,
        raid_participation: 25,
        rpg_duel_win: 100,
        'achievement.unlocked': 80,
      })
  })

  test('R10 — evento monetário vale 0 WP, sempre', () => {
    for (const t of [...MONETARY_TYPES, 'bits_badge_tier', 'bits_anything']) {
      assert.equal(wpFor(t, { bits: 10_000, total: 50, tier: 3000 }), 0, t)
      assert.equal(grantWp(t, { bits: 10_000 }, { total: 0, bySource: {} }), 0, t)
    }
  })

  test('R10 — nenhuma fonte monetária entra na tabela de pontos', () => {
    for (const t of WP_TYPES) assert.equal(MONETARY_TYPES.has(t), false, t)
  })

  test('resgate de channel points só pontua se o streamer marcou como ação de guerra', () => {
    assert.equal(wpFor(REDEEM, {}), 0)
    assert.equal(wpFor(REDEEM, { war_action: false }), 0)
    assert.equal(wpFor(REDEEM, { war_action: true }), 10)
  })

  test('tipo fora da tabela vale 0 — não existe default genérico', () => {
    for (const t of ['guild.created', 'member.joined', 'war.settled', 'inventado.aqui',
      'watch_tick', 'minigame_win', '', null, 'toString']) {
      assert.equal(wpFor(t, { war_action: true }), 0, String(t))
    }
  })

  test('R9 — teto por fonte corta o excedente e não acumula', () => {
    // raid vale 25 e o teto da fonte é 25: o segundo do dia vale 0.
    assert.equal(grantWp('raid_participation', {}, { total: 0, bySource: {} }), 25)
    assert.equal(grantWp('raid_participation', {}, { total: 25, bySource: { raid_participation: 25 } }), 0)
    // watch.tick: 60 no dia; o 61º não pontua.
    assert.equal(grantWp('watch.tick', {}, { total: 59, bySource: { 'watch.tick': 59 } }), 1)
    assert.equal(grantWp('watch.tick', {}, { total: 60, bySource: { 'watch.tick': 60 } }), 0)
  })

  test('R9 — teto global de 250 WP por membro por dia UTC', () => {
    assert.equal(DAILY_CAP, 250)
    assert.equal(grantWp('achievement.unlocked', {}, { total: 240, bySource: {} }), 10)
    assert.equal(grantWp('achievement.unlocked', {}, { total: 250, bySource: {} }), 0)
    assert.equal(grantWp('achievement.unlocked', {}, { total: 999, bySource: {} }), 0)
  })

  test('o corte é sempre o menor entre teto de fonte e teto global', () => {
    // 70 de rpg_duel_win já usados (teto 100) e 245 no dia: sobram 5.
    assert.equal(grantWp('rpg_duel_win', {}, { total: 245, bySource: { rpg_duel_win: 70 } }), 5)
    // teto da fonte estourado, mesmo com espaço no dia
    assert.equal(grantWp('rpg_duel_win', {}, { total: 100, bySource: { rpg_duel_win: 100 } }), 0)
  })

  test('dia UTC do evento, não o do processamento', () => {
    assert.equal(utcDay('2026-03-01T23:59:59Z'), '2026-03-01')
    assert.equal(utcDay('2026-03-02T00:00:00Z'), '2026-03-02')
  })

  test('a tabela pública espelha a tabela interna', () => {
    const pub = publicWpTable()
    assert.equal(pub.cap_daily, DAILY_CAP)
    assert.equal(pub.rules.length, WP_TYPES.length)
    assert.deepEqual(pub.rules.find(r => r.type === 'watch.tick'),
      { type: 'watch.tick', wp: 1, cap_daily: 60 })
  })
})

// ---------------------------------------------------------------------------
// Roster simétrico (§6) — 50 × 10 vira 10 × 10.
// ---------------------------------------------------------------------------
describe('roster simétrico (§6)', () => {
  test('min(ativos_A, ativos_B, 25)', () => {
    assert.equal(rosterSize(50, 10), 10)
    assert.equal(rosterSize(10, 50), 10)
    assert.equal(rosterSize(50, 40), ROSTER_MAX)
    assert.equal(rosterSize(25, 25), 25)
    assert.equal(rosterSize(7, 7), 7)
  })

  test('abaixo de 3 ativos a guerra não abre', () => {
    assert.equal(ROSTER_MIN, 3)
    for (const [a, b] of [[2, 40], [40, 2], [0, 0], [3, 1]]) {
      assert.equal(rosterTooSmall(rosterSize(a, b)), true, `${a}x${b}`)
    }
    assert.equal(rosterTooSmall(rosterSize(3, 3)), false)
  })

  test('lixo de entrada não vira roster negativo nem NaN', () => {
    for (const v of [null, undefined, -5, 'dez', NaN]) {
      assert.equal(rosterSize(v, 10), 0, String(v))
      assert.equal(Number.isInteger(rosterSize(v, 10)), true)
    }
  })
})

// ---------------------------------------------------------------------------
// Anti-conluio e apuração (R8, R11, R14).
// ---------------------------------------------------------------------------
describe('anti-conluio (R11)', () => {
  test('guerra normal apura com multiplicador 1', () => {
    assert.equal(prestigeMultiplier({}), 1)
    assert.equal(prestigeMultiplier({ repeatedPair: false, settledThisWeek: 1 }), 1)
  })

  test('R11(a) — par repetido em 14 dias cai para 0.25', () => {
    assert.equal(REPEAT_MULTIPLIER, 0.25)
    assert.equal(prestigeMultiplier({ repeatedPair: true }), 0.25)
    assert.equal(prestigeMultiplier({ repeatedPair: true, settledThisWeek: 1 }), 0.25)
  })

  test('R11(b) — da 3ª guerra da semana ISO em diante, 0', () => {
    assert.equal(WEEKLY_FULL_WARS, 2)
    assert.equal(prestigeMultiplier({ settledThisWeek: 2 }), 0)
    assert.equal(prestigeMultiplier({ settledThisWeek: 9 }), 0)
    // o teto semanal manda sobre o par repetido
    assert.equal(prestigeMultiplier({ repeatedPair: true, settledThisWeek: 2 }), 0)
  })

  test('Prestígio do vencedor e do perdedor, com e sem multiplicador', () => {
    const base = { challengerGuildId: 1, defenderGuildId: 2, winnerGuildId: 1 }
    assert.deepEqual(prestigeAwards('campaign', base), { 1: 500, 2: 120 })
    assert.deepEqual(prestigeAwards('campaign', { ...base, multiplier: 0.25 }), { 1: 125, 2: 30 })
    assert.deepEqual(prestigeAwards('campaign', { ...base, multiplier: 0 }), { 1: 0, 2: 0 })
    assert.deepEqual(prestigeAwards('skirmish', { ...base, winnerGuildId: 2 }), { 2: 150, 1: 40 })
    assert.deepEqual(prestigeAwards('special', base), { 1: 900, 2: 200 })
  })

  test('R14 — empate paga o valor de empate aos dois lados', () => {
    const draw = { challengerGuildId: 1, defenderGuildId: 2, winnerGuildId: null }
    assert.deepEqual(prestigeAwards('skirmish', draw), { 1: 80, 2: 80 })
    assert.deepEqual(prestigeAwards('campaign', draw), { 1: 250, 2: 250 })
    assert.deepEqual(prestigeAwards('special', { ...draw, multiplier: 0.25 }), { 1: 113, 2: 113 })
  })

  test('R8 — no_contest paga 0 aos dois', () => {
    assert.deepEqual(
      prestigeAwards('special', { challengerGuildId: 1, defenderGuildId: 2, noContest: true }),
      { 1: 0, 2: 0 })
  })

  test('Prestígio nunca é negativo, em nenhum formato', () => {
    for (const f of FORMAT_KEYS) {
      for (const m of [0, 0.25, 1]) {
        const awards = prestigeAwards(f, {
          challengerGuildId: 1, defenderGuildId: 2, winnerGuildId: 2, multiplier: m,
        })
        for (const v of Object.values(awards)) assert.ok(v >= 0, `${f} m=${m}: ${v}`)
      }
    }
  })
})

describe('resultado da guerra (R8, R14, §5)', () => {
  const side = (guildId, score, extra = {}) => ({ guildId, score, ...extra })

  test('R8 — abaixo do piso de atividade apura como no_contest', () => {
    assert.deepEqual(
      resolveWar({ format: 'skirmish', challenger: side(1, 199), defender: side(2, 10) }),
      { status: 'no_contest', winnerGuildId: null })
    assert.deepEqual(
      resolveWar({ format: 'campaign', challenger: side(1, 799), defender: side(2, 799) }),
      { status: 'no_contest', winnerGuildId: null })
    assert.deepEqual(
      resolveWar({ format: 'special', challenger: side(1, 1499), defender: side(2, 0) }),
      { status: 'no_contest', winnerGuildId: null })
  })

  test('R8 — 0 × 0 é no_contest mesmo com piso 0 impossível', () => {
    assert.equal(
      resolveWar({ format: 'skirmish', challenger: side(1, 0), defender: side(2, 0) }).status,
      'no_contest')
  })

  test('maior WP vence quando o piso é batido', () => {
    assert.deepEqual(
      resolveWar({ format: 'skirmish', challenger: side(1, 250), defender: side(2, 240) }),
      { status: 'settled', winnerGuildId: 1 })
    assert.deepEqual(
      resolveWar({ format: 'skirmish', challenger: side(1, 100), defender: side(2, 240) }),
      { status: 'settled', winnerGuildId: 2 })
  })

  test('R14 — empate acima do piso apura sem vencedor', () => {
    assert.deepEqual(
      resolveWar({ format: 'campaign', challenger: side(1, 900), defender: side(2, 900) }),
      { status: 'settled', winnerGuildId: null })
  })

  test('§5 — special desempata por territórios, depois por WP do último dia', () => {
    const empate = (extraA, extraB) => resolveWar({
      format: 'special',
      challenger: side(1, 2000, extraA),
      defender: side(2, 2000, extraB),
    })
    assert.equal(empate({ territories: 2 }, { territories: 1 }).winnerGuildId, 1)
    assert.equal(empate({ territories: 1 }, { territories: 3 }).winnerGuildId, 2)
    assert.equal(empate({ territories: 1, lastDayScore: 10 },
      { territories: 1, lastDayScore: 40 }).winnerGuildId, 2)
    assert.equal(empate({ territories: 1, lastDayScore: 10 },
      { territories: 1, lastDayScore: 10 }).winnerGuildId, null)
  })

  test('desempate por território só existe no special', () => {
    const r = resolveWar({
      format: 'campaign',
      challenger: side(1, 900, { territories: 4 }),
      defender: side(2, 900, { territories: 0 }),
    })
    assert.equal(r.winnerGuildId, null)
  })
})

// ---------------------------------------------------------------------------
// Placar agregado (§7, D5) — uma mensagem por canal, 5 KB, até 8 guerras.
// ---------------------------------------------------------------------------
describe('war.board agregado (§7)', () => {
  const war = (i) => ({
    id: 1000 + i,
    format: 'campaign',
    ends_at: new Date('2026-03-08T00:00:00Z'),
    score_seq: 40 + i,
    challenger_guild_id: 10 + i,
    defender_guild_id: 20 + i,
    challenger_tag: `AAA${i}`,
    defender_tag: `BBB${i}`,
    score_challenger: 1450 + i,
    score_defender: 1320 + i,
  })
  const wars = (n) => Array.from({ length: n }, (_, i) => war(i))

  test('shape da mensagem: um war.board com todas as guerras do canal', () => {
    const { message } = buildBoard(wars(3), { channelId: 7, seq: 99, sentAt: ts('2026-03-02T00:00:00Z') })
    assert.equal(message.type, 'war.board')
    assert.equal(message.channel_id, 7)
    assert.equal(message.seq, 99)
    assert.equal(message.sent_at, '2026-03-02T00:00:00.000Z')
    assert.equal(message.wars.length, 3)
    assert.deepEqual(message.wars[0].challenger, { guild_id: 10, tag: 'AAA0', score: 1450 })
    assert.equal(message.wars[0].seq, 40)
    assert.equal(message.wars[0].ends_at, '2026-03-08T00:00:00.000Z')
  })

  test('D5 — no máximo 8 guerras por mensagem; o resto conta como dropped', () => {
    assert.equal(MAX_WARS_PER_BOARD, 8)
    const { message, dropped } = buildBoard(wars(20), { channelId: 1 })
    assert.equal(message.wars.length, 8)
    assert.equal(dropped, 12)
  })

  test('8 guerras cabem folgadas nos 5 KB do tópico', () => {
    assert.equal(BOARD_LIMIT_BYTES, 5120)
    const { message, bytes, truncated } = buildBoard(wars(8), { channelId: 1 })
    assert.equal(message.wars.length, 8)
    assert.ok(bytes < BOARD_LIMIT_BYTES, `${bytes} bytes`)
    assert.equal(truncated, false)
  })

  test('a mensagem nunca ultrapassa o limite: corta pelo fim até caber', () => {
    const gordas = wars(8).map(w => ({ ...w, challenger_tag: 'T'.repeat(120), defender_tag: 'D'.repeat(120) }))
    const { message, bytes, dropped } = buildBoard(gordas, { channelId: 1, limitBytes: 700 })
    assert.ok(bytes <= 700, `${bytes} bytes`)
    assert.ok(message.wars.length < 8)
    assert.equal(dropped, 8 - message.wars.length)
    assert.equal(boardBytes(message), bytes)
  })

  test('canal sem guerra ativa produz mensagem vazia e minúscula', () => {
    const { message, bytes, dropped } = buildBoard([], { channelId: 3 })
    assert.deepEqual(message.wars, [])
    assert.equal(dropped, 0)
    assert.ok(bytes < 120)
  })

  test('war.ended leva placar final e vencedor', () => {
    const msg = buildEnded({
      id: 5, score_seq: 12, winner_guild_id: 10, score_challenger: 900, score_defender: 700,
    })
    assert.deepEqual(msg, {
      type: 'war.ended',
      war_id: 5,
      seq: 12,
      winner_guild_id: 10,
      score: { challenger: 900, defender: 700 },
    })
  })
})

// ---------------------------------------------------------------------------
// Migração — as travas que o doc exige que sejam do banco, não da aplicação.
// ---------------------------------------------------------------------------
describe('050_wars.sql', () => {
  let sql
  before(async () => {
    sql = await readFile(new URL('../src/core/migrations/050_wars.sql', import.meta.url), 'utf8')
  })

  test('R1 — uma guerra aberta por guilda é PK, não checagem de aplicação', () => {
    assert.match(sql, /CREATE TABLE war_slot[\s\S]*PRIMARY KEY \(channel_id, guild_id\)/)
  })

  test('R16 — o mesmo guild_event nunca vira dois pontos na mesma guerra', () => {
    assert.match(sql, /CONSTRAINT war_point_once UNIQUE \(war_id, event_id\)/)
  })

  test('um território tem no máximo um dono vigente', () => {
    assert.match(sql,
      /CREATE UNIQUE INDEX territory_current_owner ON territory_holding \(territory_id\)\s*WHERE released_at IS NULL/)
  })

  test('R24 — uma disputa aberta por território', () => {
    assert.match(sql,
      /CREATE UNIQUE INDEX dispute_one_open ON territory_dispute \(territory_id\)\s*WHERE status = 'open'/)
  })

  test('stake só no formato special, e vencedor sempre é um dos dois lados', () => {
    assert.match(sql, /war_stake\s+CHECK \(stake_territory_id IS NULL OR format = 'special'\)/)
    assert.match(sql, /war_winner\s+CHECK \(winner_guild_id IS NULL/)
  })

  test('nenhuma tabela de domínio sem channel_id (multi-tenant)', () => {
    for (const t of ['territory', 'territory_dispute', 'war', 'war_slot', 'territory_holding']) {
      const bloco = sql.slice(sql.indexOf(`CREATE TABLE ${t} (`))
      assert.match(bloco.slice(0, bloco.indexOf(');')), /channel_id\s+BIGINT\s+NOT NULL/, t)
    }
  })
})

// ---------------------------------------------------------------------------
// Integração — só roda com Postgres migrado.
// `DATABASE_URL=... npm run migrate && DATABASE_URL=... npm test`
// ---------------------------------------------------------------------------
describe('guerra e território (Postgres)', { skip: !process.env.DATABASE_URL }, () => {
  let db, mod, channelId
  const sufixo = randomBytes(3).toString('hex')
  const guilds = {}

  const newGuild = async (name, tag) => {
    const { rows: [g] } = await db.query(
      `INSERT INTO guild (channel_id, name, tag, status, leader_user_id, creator_user_id,
                          member_count, payment_status, bits_amount, bits_transaction_id)
       VALUES ($1, $2, $3, 'active', $4, $4, 1, 'paid', 500, $5) RETURNING id`,
      [channelId, name, tag, `u-${tag}-${sufixo}`, `tx-${tag}-${sufixo}`])
    return g.id
  }

  const newWar = async (challenger, defender, extra = {}) => {
    const { rows: [w] } = await db.query(
      `INSERT INTO war (channel_id, format, status, challenger_guild_id, defender_guild_id,
                        roster_size, min_points, declared_by, challenge_expires_at,
                        starts_at, ends_at)
       VALUES ($1, 'skirmish', coalesce($4::war_status, 'pending'), $2, $3, 3, 200, 'u1',
               now() + interval '2 hours', now() - interval '1 hour', now() + interval '5 hours')
       RETURNING *`,
      [channelId, challenger, defender, extra.status ?? null])
    return w
  }

  before(async () => {
    db = await import('../src/core/db.js')
    mod = await import('../src/modules/wars/index.js')
    const { migrate } = await import('../src/core/migrate.js')
    await migrate(() => {})

    const { rows: [ch] } = await db.query(
      'INSERT INTO channel (twitch_channel_id) VALUES ($1) RETURNING id', [`test-war-${sufixo}`])
    channelId = ch.id
    guilds.a = await newGuild('Void Warriors', 'VDW')
    guilds.b = await newGuild('Eclipse Warriors', 'ECW')
    guilds.c = await newGuild('Arcadia Warriors', 'ARW')
  })

  after(async () => {
    if (channelId) await db.query('DELETE FROM channel WHERE id = $1', [channelId])
    if (db) await db.pool.end()
  })

  test('R1: a segunda guerra da mesma guilda esbarra na PK de war_slot', async () => {
    const w1 = await newWar(guilds.a, guilds.b)
    await db.query('INSERT INTO war_slot (channel_id, guild_id, war_id) VALUES ($1, $2, $3)',
      [channelId, guilds.a, w1.id])
    const w2 = await newWar(guilds.c, guilds.a)
    await assert.rejects(
      db.query('INSERT INTO war_slot (channel_id, guild_id, war_id) VALUES ($1, $2, $3)',
        [channelId, guilds.a, w2.id]),
      (err) => err.code === '23505')
  })

  test('R16: o mesmo guild_event não vira dois war_point', async () => {
    const w = await newWar(guilds.b, guilds.c, { status: 'active' })
    const { rows: [ev] } = await db.query(
      `INSERT INTO guild_event (channel_id, guild_id, type, payload, actor_user_id)
       VALUES ($1, $2, 'watch.tick', '{}', $3) RETURNING id`,
      [channelId, guilds.b, `u-${sufixo}`])
    const insert = () => db.query(
      `INSERT INTO war_point (war_id, guild_id, user_id, event_id, event_type, points)
       VALUES ($1, $2, $3, $4, 'watch.tick', 1)`,
      [w.id, guilds.b, `u-${sufixo}`, ev.id])
    await insert()
    await assert.rejects(insert(), (err) => err.code === '23505')
  })

  test('um território nunca tem dois donos vigentes', async () => {
    const { rows: [t] } = await db.query(
      `INSERT INTO territory (channel_id, slug, name, map_x, map_y)
       VALUES ($1, $2, $3, 100, 100) RETURNING id`,
      [channelId, `floresta-${sufixo}`, `Floresta ${sufixo}`])
    const hold = (guildId) => db.query(
      `INSERT INTO territory_holding (territory_id, guild_id, channel_id, acquired_via, protected_until)
       VALUES ($1, $2, $3, 'admin', now() + interval '48 hours')`,
      [t.id, guildId, channelId])
    await hold(guilds.a)
    await assert.rejects(hold(guilds.b), (err) => err.code === '23505')
  })

  test('WP: watch.tick de membro do roster pontua; cheer do mesmo membro não', async () => {
    const w = await newWar(guilds.c, guilds.a, { status: 'active' })
    const user = `wp-${sufixo}`
    await db.query(
      `INSERT INTO guild_member (guild_id, user_id, channel_id, role) VALUES ($1, $2, $3, 'member')`,
      [guilds.c, user, channelId])
    await db.query(
      'INSERT INTO war_roster (war_id, guild_id, user_id, added_by) VALUES ($1, $2, $3, $3)',
      [w.id, guilds.c, user])
    for (const type of ['watch.tick', 'channel.cheer']) {
      await db.query(
        `INSERT INTO guild_event (channel_id, guild_id, type, payload, actor_user_id)
         VALUES ($1, $2, $3, '{"bits":1000}', $4)`, [channelId, guilds.c, type, user])
    }
    await mod.ingestWarPointsOnce({ log: { error () {} } })

    const { rows } = await db.query(
      'SELECT event_type, points FROM war_point WHERE war_id = $1', [w.id])
    assert.deepEqual(rows, [{ event_type: 'watch.tick', points: 1 }])
    const { rows: [war] } = await db.query('SELECT * FROM war WHERE id = $1', [w.id])
    assert.equal(war.score_challenger, 1)
    assert.equal(war.score_defender, 0)

    // R16 — reprocessar a fila não mexe no placar.
    await mod.ingestWarPointsOnce({ log: { error () {} } })
    const { rows: [again] } = await db.query('SELECT * FROM war WHERE id = $1', [w.id])
    assert.equal(again.score_challenger, 1)
  })
})
