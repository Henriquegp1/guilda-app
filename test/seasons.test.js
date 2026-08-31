import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import {
  ACTIVITY_TYPES, MAX_ADJUST, MONETARY_TYPES, PARTICIPATE_CAP, POINTS, PRESTIGE_TYPES,
  WEEKLY_OBJECTIVE, clampAdjust, isoWeek, participateTotal, prestigeFor,
  qualifiesForStreak, weekRange, weeklyObjectiveMet, winDaysInWindow,
} from '../src/modules/seasons/prestige.js'
import {
  CURSOR_TTL_MS, MAX_LIMIT, RANK_ORDER_SQL, compareRank, cursorExpired,
  decodeCursor, encodeCursor, rankRows,
} from '../src/modules/seasons/ranking.js'
import {
  ACHIEVEMENTS, RARITIES, TRIGGER_TYPES, evaluate, evaluateAll,
} from '../src/modules/seasons/achievements.js'
import {
  ARCHIVE_MS, FREEZE_MS, SEASON_DAYS, dueStatus, earlyEnd, inSeason, nextWindow,
} from '../src/modules/seasons/lifecycle.js'
import { MAX_LEVEL } from '../src/modules/xp/curve.js'
 
const DAY = 86_400_000
const ts = (iso) => new Date(iso)
 
// ---------------------------------------------------------------------------
// Fórmula de Prestígio (§4.1) — a tabela do doc transcrita como expectativa.
// ---------------------------------------------------------------------------
describe('fontes de Prestígio (§4.1)', () => {
  test('a tabela fechada do doc', () => {
    assert.equal(prestigeFor('event.win'), 500)
    assert.equal(prestigeFor('event.placement', { rank: 2 }), 300)
    assert.equal(prestigeFor('event.placement', { rank: 3 }), 150)
    assert.equal(prestigeFor('event.participate'), 10)
    assert.equal(prestigeFor('weekly.objective_completed'), 250)
    assert.equal(prestigeFor('guild.level_up', { from: 7, to: 8 }), 100)
    assert.equal(POINTS.streak, 200)
  })
 
  test('1º lugar e colocações fora do pódio não pontuam por placement', () => {
    for (const rank of [1, 4, 10, 0, -1, null, undefined, 'dois']) {
      assert.equal(prestigeFor('event.placement', { rank }), 0, `rank=${rank}`)
    }
  })
 
  test('queda de nível não credita nem debita', () => {
    assert.equal(prestigeFor('guild.level_up', { from: 9, to: 8 }), 0)
    assert.equal(prestigeFor('guild.level_up', { from: 8, to: 8 }), 0)
  })
 
  test('tipo desconhecido vale 0 e não vira linha de ledger', () => {
    for (const t of ['guild.created', 'member.left', 'war.settled', 'inventado.aqui']) {
      assert.equal(prestigeFor(t, { rank: 2, amount: 5000 }), 0)
    }
  })
 
  test('PRESTIGE_TYPES cobre exatamente as fontes que pontuam', () => {
    for (const t of PRESTIGE_TYPES) {
      const exemplo = prestigeFor(t, { rank: 2, from: 1, to: 2, amount: 100 })
      assert.notEqual(exemplo, 0, `${t} deveria pontuar`)
    }
  })
})
 
// ---------------------------------------------------------------------------
// R3 — o princípio do produto. Bits nunca compram posição.
// ---------------------------------------------------------------------------
describe('R3: fonte monetária vale ZERO de Prestígio', () => {
  const monetarios = [
    ['channel.cheer', { bits: 100_000 }],
    ['channel.subscribe', { tier: 3000 }],
    ['channel.subscription.gift', { total: 100 }],
    ['channel.subscription.end', {}],
    ['channel.channel_points_custom_reward_redemption.add', { guild_xp: true }],
    ['channel.follow', {}],
  ]
 
  test('cheer, sub, gift, resgate e follow valem 0', () => {
    for (const [type, payload] of monetarios) {
      assert.equal(prestigeFor(type, payload), 0, type)
      assert.ok(MONETARY_TYPES.has(type), `${type} deveria estar em MONETARY_TYPES`)
    }
  })
 
  test('nem com payload forjado de outra fonte um evento monetário pontua', () => {
    for (const [type] of monetarios) {
      assert.equal(prestigeFor(type, { rank: 2, from: 1, to: 50, amount: 5000 }), 0, type)
    }
  })
 
  test('nenhuma fonte monetária aparece na lista de tipos varridos', () => {
    for (const t of PRESTIGE_TYPES) assert.equal(MONETARY_TYPES.has(t), false, t)
  })
 
  test('o objetivo semanal também não conta atividade monetária', () => {
    for (const [type] of monetarios) {
      assert.equal(ACTIVITY_TYPES.includes(type), false, type)
    }
  })
})
 
// ---------------------------------------------------------------------------
// R5 — teto de 20 contribuintes por evento.
// ---------------------------------------------------------------------------
describe('R5: participação tem teto de 20 membros por evento', () => {
  test('o 20º membro pontua, o 21º vale 0 (e não é erro)', () => {
    assert.equal(prestigeFor('event.participate', {}, { contributors: 19 }), 10)
    assert.equal(prestigeFor('event.participate', {}, { contributors: 20 }), 0)
    assert.equal(prestigeFor('event.participate', {}, { contributors: 34 }), 0)
    assert.equal(PARTICIPATE_CAP, 20)
  })
 
  test('evento com 35 participantes gera no máximo 200 pontos (critério de aceite)', () => {
    assert.equal(participateTotal(35), 200)
    assert.equal(participateTotal(20), 200)
    assert.equal(participateTotal(19), 190)
    assert.equal(participateTotal(0), 0)
    // Somando membro a membro dá o mesmo teto.
    let total = 0
    for (let i = 0; i < 35; i++) total += prestigeFor('event.participate', {}, { contributors: i })
    assert.equal(total, 200)
  })
 
  test('escala do doc: 1 vitória + participação cheia ≈ 700', () => {
    assert.equal(prestigeFor('event.win') + participateTotal(20), 700)
  })
})
 
// ---------------------------------------------------------------------------
// R16 — ajuste manual.
// ---------------------------------------------------------------------------
describe('R16: ajuste manual do broadcaster', () => {
  test('a faixa é ±5000 e o excedente é aparado', () => {
    assert.equal(MAX_ADJUST, 5000)
    assert.equal(clampAdjust(9_999), 5000)
    assert.equal(clampAdjust(-9_999), -5000)
    assert.equal(clampAdjust(-250), -250)
    assert.equal(clampAdjust('300'), 300)
    assert.equal(clampAdjust(null), 0)
  })
 
  test('o handler devolve o valor aparado, não o pedido', () => {
    assert.equal(prestigeFor('prestige.manual_adjust', { amount: 50_000 }), 5000)
    assert.equal(prestigeFor('prestige.manual_adjust', { amount: -5000 }), -5000)
  })
})
 
// ---------------------------------------------------------------------------
// Bônus de sequência (§4.1) — 3 dias distintos em 7 dias corridos.
// ---------------------------------------------------------------------------
describe('bônus de sequência', () => {
  const win = (dia, hora = '12:00:00') => ts(`2026-03-${String(dia).padStart(2, '0')}T${hora}Z`)
 
  test('3 dias distintos na janela qualificam', () => {
    const wins = [win(1), win(3), win(5)]
    assert.equal(winDaysInWindow(wins, win(5)), 3)
    assert.equal(qualifiesForStreak(wins, win(5)), true)
  })
 
  test('5 vitórias em 2 dias não qualificam', () => {
    const wins = [win(1, '01:00:00'), win(1, '20:00:00'), win(2), win(2, '23:00:00'), win(2, '05:00:00')]
    assert.equal(winDaysInWindow(wins, win(2, '23:00:00')), 2)
    assert.equal(qualifiesForStreak(wins, win(2, '23:00:00')), false)
  })
 
  test('o 3º dia fora dos 7 dias corridos não qualifica', () => {
    const wins = [win(1), win(2), win(12)]
    assert.equal(qualifiesForStreak(wins, win(12)), false)
  })
 
  test('a janela é (at − 7d, at]: vitória futura não conta', () => {
    assert.equal(winDaysInWindow([win(1), win(2), win(9)], win(2)), 2)
  })
})
 
// ---------------------------------------------------------------------------
// §5.2 — desempate em 4 níveis, até ordem total.
// ---------------------------------------------------------------------------
describe('desempate do ranking (§5.2)', () => {
  const g = (o) => ({
    guild_id: 1, prestige: 0, last_gain_at: '2026-01-10T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z', ...o,
  })
 
  test('nível 1: mais Prestígio na frente', () => {
    assert.ok(compareRank(g({ prestige: 900 }), g({ prestige: 100 })) < 0)
  })
 
  test('nível 2: empate no Prestígio, quem chegou primeiro fica à frente', () => {
    const cedo = g({ guild_id: 1, prestige: 500, last_gain_at: '2026-02-01T10:00:00Z' })
    const tarde = g({ guild_id: 2, prestige: 500, last_gain_at: '2026-02-01T10:00:01Z' })
    assert.ok(compareRank(cedo, tarde) < 0)
    assert.ok(compareRank(tarde, cedo) > 0)
  })
 
  test('nível 3: mesmo Prestígio e mesmo instante, a guilda mais antiga', () => {
    const igual = { prestige: 500, last_gain_at: '2026-02-01T10:00:00Z' }
    const velha = g({ ...igual, guild_id: 9, created_at: '2025-01-01T00:00:00Z' })
    const nova = g({ ...igual, guild_id: 2, created_at: '2026-01-01T00:00:00Z' })
    assert.ok(compareRank(velha, nova) < 0)
  })
 
  test('nível 4: tudo igual, o menor id — e é o que garante ordem total', () => {
    const base = { prestige: 500, last_gain_at: '2026-02-01T10:00:00Z', created_at: '2026-01-01T00:00:00Z' }
    assert.ok(compareRank(g({ ...base, guild_id: 7 }), g({ ...base, guild_id: 8 })) < 0)
    assert.equal(compareRank(g({ ...base, guild_id: 7 }), g({ ...base, guild_id: 7 })), 0)
  })
 
  test('guilda sem ganho nenhum (last_gain_at null) fica atrás no empate', () => {
    const zerada = g({ guild_id: 2, prestige: 0, last_gain_at: null })
    const pontuou = g({ guild_id: 3, prestige: 0, last_gain_at: '2026-02-01T00:00:00Z' })
    assert.ok(compareRank(pontuou, zerada) < 0)
    // Duas sem ganho continuam decididas pelos níveis seguintes, nunca em 0.
    const outra = g({ guild_id: 5, prestige: 0, last_gain_at: null })
    assert.ok(compareRank(zerada, outra) < 0)
  })
 
  test('R11: 40 guildas empatadas recebem 40 posições distintas e estáveis', () => {
    const empatadas = Array.from({ length: 40 }, (_, i) => g({
      guild_id: 100 - i, prestige: 500,
      last_gain_at: '2026-02-01T10:00:00Z', created_at: '2026-01-01T00:00:00Z',
    }))
    const posicoes = rankRows(empatadas)
    assert.deepEqual(
      posicoes.map(r => r.position),
      Array.from({ length: 40 }, (_, i) => i + 1))
    assert.equal(new Set(posicoes.map(r => r.guild_id)).size, 40)
    // Ordem estável: embaralhar a entrada não muda o resultado.
    const outraOrdem = rankRows([...empatadas].reverse())
    assert.deepEqual(outraOrdem.map(r => r.guild_id), posicoes.map(r => r.guild_id))
    // O pódio sai sem empate por construção.
    assert.deepEqual(posicoes.slice(0, 3).map(r => r.guild_id), [61, 62, 63])
  })
 
  test('o ORDER BY do snapshot é a mesma regra do comparador', () => {
    assert.match(RANK_ORDER_SQL, /prestige DESC/)
    assert.match(RANK_ORDER_SQL, /last_gain_at ASC NULLS LAST/)
    assert.match(RANK_ORDER_SQL, /created_at ASC/)
    assert.match(RANK_ORDER_SQL, /g\.id ASC$/)
  })
})
 
// ---------------------------------------------------------------------------
// §5.3 — cursor.
// ---------------------------------------------------------------------------
describe('cursor do ranking (§5.3)', () => {
  test('ida e volta preserva snapshot e posição', () => {
    const c = encodeCursor({ snapshot_id: 42, position: 25 })
    assert.deepEqual(decodeCursor(c), { snapshot_id: 42, position: 25 })
    assert.equal(c.includes('='), false, 'cursor é base64url, sem padding')
  })
 
  test('cursor de terceiro devolve null e vira INVALID_CURSOR na rota', () => {
    for (const lixo of ['', 'abc', 'e30', Buffer.from('{"s":0,"p":1}').toString('base64url')]) {
      assert.equal(decodeCursor(lixo), null, JSON.stringify(lixo))
    }
  })
 
  test('snapshot com mais de 10 min expira; o final nunca expira', () => {
    const agora = Date.now()
    const velho = { taken_at: new Date(agora - CURSOR_TTL_MS - 1), is_final: false }
    const novo = { taken_at: new Date(agora - 60_000), is_final: false }
    assert.equal(cursorExpired(velho, agora), true)
    assert.equal(cursorExpired(novo, agora), false)
    assert.equal(cursorExpired({ ...velho, is_final: true }, agora), false)
  })
 
  test('o limite máximo da página é 100', () => assert.equal(MAX_LIMIT, 100))
})
 
// ---------------------------------------------------------------------------
// §7 — catálogo de conquistas.
// ---------------------------------------------------------------------------
describe('catálogo de conquistas (§7)', () => {
  test('as 5 do doc, com a raridade de cada uma', () => {
    assert.deepEqual(Object.keys(ACHIEVEMENTS).sort(),
      ['army', 'dominators', 'first_blood', 'immortals', 'legendary'])
    assert.equal(ACHIEVEMENTS.first_blood.rarity, 'epic')
    assert.equal(ACHIEVEMENTS.army.rarity, 'rare')
    assert.equal(ACHIEVEMENTS.immortals.rarity, 'legendary')
    assert.equal(ACHIEVEMENTS.dominators.rarity, 'legendary')
    assert.equal(ACHIEVEMENTS.legendary.rarity, 'legendary')
  })
 
  test('rarity é obrigatória e válida — a fase 07 filtra por ela', () => {
    for (const a of Object.values(ACHIEVEMENTS)) {
      assert.ok(RARITIES.includes(a.rarity), `${a.code}: rarity inválida`)
      assert.ok(['permanent', 'seasonal'].includes(a.scope), `${a.code}: scope inválido`)
      assert.ok(a.from.length > 0, `${a.code}: sem evento de origem`)
    }
    assert.equal(ACHIEVEMENTS.first_blood.scope, 'seasonal')
    assert.equal(ACHIEVEMENTS.first_blood.retroactive, false)
  })
 
  test('Exército fecha em 20 membros, não em 30', () => {
    assert.equal(ACHIEVEMENTS.army.target, 20)
    assert.equal(evaluate('army', { members: 19 }).unlocked, false)
    assert.equal(evaluate('army', { members: 20 }).unlocked, true)
    assert.equal(evaluate('army', { members: 47 }).unlocked, true)
    assert.equal(evaluate('army', { members: 19 }).current, 19)
  })
 
  test('Dominadores em 100 vitórias, somando temporadas', () => {
    assert.equal(evaluate('dominators', { wins: 99 }).unlocked, false)
    assert.equal(evaluate('dominators', { wins: 100 }).unlocked, true)
  })
 
  test('Imortais em 3 pódios, não necessariamente consecutivos', () => {
    assert.equal(evaluate('immortals', { podiums: 2 }).unlocked, false)
    assert.equal(evaluate('immortals', { podiums: 3 }).unlocked, true)
  })
 
  test('Lendários lê MAX_LEVEL da fase 03, sem hardcode (D4)', () => {
    assert.equal(ACHIEVEMENTS.legendary.target, MAX_LEVEL)
    assert.equal(evaluate('legendary', { level: MAX_LEVEL - 1 }).unlocked, false)
    assert.equal(evaluate('legendary', { level: MAX_LEVEL }).unlocked, true)
  })
 
  test('Primeiro Sangue é gatilho único, sem meta numérica', () => {
    assert.equal(ACHIEVEMENTS.first_blood.target, null)
    assert.equal(evaluate('first_blood', { first_win_of_season: false }).unlocked, false)
    assert.equal(evaluate('first_blood', { first_win_of_season: true }).unlocked, true)
  })
 
  test('guilda zerada não desbloqueia nada', () => {
    const nada = evaluateAll({ members: 0, wins: 0, podiums: 0, level: 1 })
    assert.deepEqual(nada.filter(a => a.unlocked), [])
    assert.equal(nada.length, 5)
  })
 
  test('os gatilhos são tipos registrados em docs/EVENTOS.md', async () => {
    const { EVENT_TYPES } = await import('../src/core/events.js')
    for (const t of TRIGGER_TYPES) assert.ok(EVENT_TYPES.has(t), `${t} não registrado`)
  })
 
  test('a migração 040 espelha o catálogo (code, rarity, scope, target)', async () => {
    const sql = await readFile(new URL('../src/core/migrations/040_seasons.sql', import.meta.url), 'utf8')
    const seed = [...sql.matchAll(
      /\('(\w+)', '[^']*', '[^']*', '(\w+)', '(\w+)', (NULL|\d+)\)/g)]
    assert.equal(seed.length, 5, 'seed de achievement incompleto')
    for (const [, code, rarity, scope, target] of seed) {
      const a = ACHIEVEMENTS[code]
      assert.ok(a, `${code} está na migração e não no catálogo`)
      assert.equal(rarity, a.rarity, `${code}: rarity diverge`)
      assert.equal(scope, a.scope, `${code}: scope diverge`)
      assert.equal(target === 'NULL' ? null : Number(target), a.target, `${code}: target diverge`)
    }
  })
})
 
// ---------------------------------------------------------------------------
// §6 — bordas da temporada.
// ---------------------------------------------------------------------------
describe('bordas da temporada (§6)', () => {
  const season = (o = {}) => ({
    id: 1, number: 1, status: 'active',
    starts_at: '2026-01-01T00:00:00Z', ends_at: '2026-04-01T00:00:00Z', closed_at: null, ...o,
  })
 
  test('a temporada dura 90 dias e a janela vive em dados', () => {
    assert.equal(SEASON_DAYS, 90)
    const next = nextWindow(season())
    assert.equal(+next.ends_at - +next.starts_at, 90 * DAY)
    assert.equal(next.number, 2)
  })
 
  test('R9: a seguinte começa exatamente no ends_at da anterior', () => {
    const s = season()
    assert.equal(+nextWindow(s).starts_at, +ts(s.ends_at))
  })
 
  test('R7: a janela é [starts_at, ends_at) — o instante do fim já é da seguinte', () => {
    const s = season()
    assert.equal(inSeason(ts('2026-01-01T00:00:00Z'), s), true)
    assert.equal(inSeason(ts('2026-03-31T23:59:59Z'), s), true)
    assert.equal(inSeason(ts('2026-04-01T00:00:00Z'), s), false)
    assert.equal(inSeason(ts('2025-12-31T23:59:59Z'), s), false)
    assert.equal(inSeason(ts(s.ends_at), nextWindow(s)), true)
  })
 
  test('scheduled vira active no starts_at, não antes', () => {
    const s = season({ status: 'scheduled' })
    assert.equal(dueStatus(s, ts('2025-12-31T23:59:59Z')), 'scheduled')
    assert.equal(dueStatus(s, ts('2026-01-01T00:00:00Z')), 'active')
  })
 
  test('active vira freezing no ends_at e só fecha 1 h depois', () => {
    const s = season()
    assert.equal(dueStatus(s, ts('2026-03-31T23:59:59Z')), 'active')
    assert.equal(dueStatus(s, ts('2026-04-01T00:00:00Z')), 'freezing')
 
    const congelada = season({ status: 'freezing' })
    assert.equal(FREEZE_MS, 3_600_000)
    assert.equal(dueStatus(congelada, new Date(+ts(s.ends_at) + FREEZE_MS - 1)), 'freezing')
    assert.equal(dueStatus(congelada, new Date(+ts(s.ends_at) + FREEZE_MS)), 'closed')
  })
 
  test('closed vira archived 30 dias depois, e archived não anda mais', () => {
    const fechada = season({ status: 'closed', closed_at: '2026-04-01T01:00:00Z' })
    assert.equal(dueStatus(fechada, ts('2026-04-30T00:00:00Z')), 'closed')
    assert.equal(dueStatus(fechada, new Date(+ts(fechada.closed_at) + ARCHIVE_MS)), 'archived')
    assert.equal(dueStatus(season({ status: 'archived' }), new Date(3e12)), 'archived')
  })
 
  test('fuso não entra na conta: a comparação é sempre em UTC (R10)', () => {
    const s = season({ starts_at: '2026-01-01T03:00:00Z' })  // meia-noite em São Paulo
    assert.equal(dueStatus({ ...s, status: 'scheduled' }, ts('2026-01-01T02:59:59Z')), 'scheduled')
    assert.equal(dueStatus({ ...s, status: 'scheduled' }, ts('2026-01-01T03:00:00Z')), 'active')
  })
 
  test('encerramento antecipado respeita o mínimo de 7 dias da janela', () => {
    const s = season()
    const cedo = earlyEnd(s, ts('2026-01-02T00:00:00Z'))
    assert.ok(+cedo > +ts(s.starts_at) + 7 * DAY, 'não pode violar season_window_ck')
    const tarde = earlyEnd(s, ts('2026-02-01T00:00:00Z'))
    assert.equal(+tarde, +ts('2026-02-01T00:00:00Z'))
  })
})
 
// ---------------------------------------------------------------------------
// D1 — objetivo semanal automático.
// ---------------------------------------------------------------------------
describe('objetivo semanal (D1)', () => {
  test('vale 250 e é o mesmo número da tabela de fontes', () => {
    assert.equal(WEEKLY_OBJECTIVE.points, 250)
    assert.equal(prestigeFor('weekly.objective_completed'), WEEKLY_OBJECTIVE.points)
  })
 
  test('3 membros distintos em 3 dias distintos concluem', () => {
    assert.equal(weeklyObjectiveMet({ members: 3, days: 3 }), true)
    assert.equal(weeklyObjectiveMet({ members: 2, days: 7 }), false)
    assert.equal(weeklyObjectiveMet({ members: 9, days: 2 }), false)
    assert.equal(weeklyObjectiveMet({}), false)
  })
 
  test('a semana ISO é a chave de idempotência e vira segunda-feira', () => {
    // 2026-01-01 é quinta: semana 01 de 2026, que começa na segunda 2025-12-29.
    assert.equal(isoWeek(ts('2026-01-01T12:00:00Z')), '2026-W01')
    const { key, start, end } = weekRange(ts('2026-01-01T12:00:00Z'))
    assert.equal(key, '2026-W01')
    assert.equal(start.toISOString(), '2025-12-29T00:00:00.000Z')
    assert.equal(+end - +start, 7 * DAY)
    // Domingo ainda é da semana que começou na segunda anterior.
    assert.equal(isoWeek(ts('2026-01-04T23:59:59Z')), '2026-W01')
    assert.equal(isoWeek(ts('2026-01-05T00:00:00Z')), '2026-W02')
  })
 
  test('semanas diferentes geram chaves diferentes ao longo do ano', () => {
    const chaves = new Set()
    for (let i = 0; i < 52; i++) chaves.add(isoWeek(new Date(+ts('2026-01-05T00:00:00Z') + i * 7 * DAY)))
    assert.equal(chaves.size, 52)
  })
})
 
// ---------------------------------------------------------------------------
// Integração — só roda com Postgres migrado.
// `DATABASE_URL=... npm run migrate && DATABASE_URL=... npm test`
// ---------------------------------------------------------------------------
describe('Prestígio, ranking e conquistas (Postgres)', { skip: !process.env.DATABASE_URL }, () => {
  let db, emit, mod, channelId, seasonId
  const sufixo = randomBytes(3).toString('hex')
  const guilds = {}
 
  /** Emite o evento e roda o handler na mesma transação, como faz o job. */
  const fire = (type, payload, guildId, externalId = null, userId = null) => db.tx(async (c) => {
    const ev = await emit(c, {
      channelId, guildId, type, payload, actorUserId: userId, externalId,
    })
    if (!ev) return null                              // duplicata: o core já barrou
    return mod.applyPrestige(c, {
      ...ev, channel_id: channelId, guild_id: guildId, season_id: seasonId, type, payload,
    })
  })
 
  const prestigeOf = async (guildId, season = seasonId) => (await db.query(
    'SELECT prestige FROM guild_season_prestige WHERE season_id = $1 AND guild_id = $2',
    [season, guildId])).rows[0]?.prestige ?? 0
 
  const ledgerCount = async (guildId) => (await db.query(
    'SELECT count(*)::int AS n FROM prestige_ledger WHERE season_id = $1 AND guild_id = $2',
    [seasonId, guildId])).rows[0].n
 
  const newGuild = async (name, tag) => {
    const { rows: [g] } = await db.query(
      `INSERT INTO guild (channel_id, name, tag, status, leader_user_id, creator_user_id,
                          member_count, payment_status, bits_amount, bits_transaction_id)
       VALUES ($1, $2, $3, 'active', $4, $4, 1, 'paid', 500, $5) RETURNING id`,
      [channelId, name, tag, `u-${tag}-${sufixo}`, `tx-${tag}-${sufixo}`])
    return g.id
  }
 
  before(async () => {
    db = await import('../src/core/db.js')
    ;({ emit } = await import('../src/core/events.js'))
    mod = await import('../src/modules/seasons/index.js')
    const { migrate } = await import('../src/core/migrate.js')
    await migrate(() => {})
 
    const { rows: [ch] } = await db.query(
      'INSERT INTO channel (twitch_channel_id) VALUES ($1) RETURNING id', [`test-season-${sufixo}`])
    channelId = ch.id
    const { rows: [s] } = await db.query(
      `INSERT INTO season (channel_id, number, name, status, starts_at, ends_at)
       VALUES ($1, 1, 'Temporada de Teste', 'active', now() - interval '10 days',
               now() + interval '80 days') RETURNING id`, [channelId])
    seasonId = s.id
    guilds.a = await newGuild('Void Testers', 'VOID')
    guilds.b = await newGuild('Eclipse Testers', 'ECL')
  })
 
  after(async () => {
    if (channelId) await db.query('DELETE FROM channel WHERE id = $1', [channelId])
    const { closeRedis } = await import('../src/core/redis.js')
    await closeRedis()
    if (db) await db.pool.end()
  })
 
  test('R1: um event.win gera 1 linha de 500 e soma no agregado', async () => {
    const entry = await fire('event.win', { event_id: `w1-${sufixo}` }, guilds.a, `w1-${sufixo}`)
    assert.equal(entry.points, 500)
    assert.equal(await prestigeOf(guilds.a), 500)
  })
 
  test('R4: reprocessar o mesmo evento não altera o total', async () => {
    const { rows: [ev] } = await db.query(
      "SELECT * FROM guild_event WHERE guild_id = $1 AND type = 'event.win' LIMIT 1", [guilds.a])
    const repeat = await db.tx(c => mod.applyPrestige(c, { ...ev, season_id: seasonId }))
    assert.equal(repeat, null)
    assert.equal(await prestigeOf(guilds.a), 500)
  })
 
  test('R3: cheer e sub gift não produzem nenhuma linha em prestige_ledger', async () => {
    const antes = await ledgerCount(guilds.a)
    await fire('channel.cheer', { bits: 50_000 }, guilds.a, `cheer-${sufixo}`)
    await fire('channel.subscription.gift', { total: 50 }, guilds.a, `gift-${sufixo}`)
    assert.equal(await ledgerCount(guilds.a), antes)
    assert.equal(await prestigeOf(guilds.a), 500)
  })
 
  test('R5: evento com 35 participantes gera no máximo 200 pontos', async () => {
    const eventId = `part-${sufixo}`
    const antes = await prestigeOf(guilds.b)
    for (let i = 0; i < 35; i++) {
      await fire('event.participate', { event_id: eventId, user_id: `p${i}` },
        guilds.b, `${eventId}:${i}`, `p${i}`)
    }
    assert.equal(await prestigeOf(guilds.b) - antes, 200)
  })
 
  test('R16: ajuste de −5000 sobre 200 pontos deixa o Prestígio em 0, não negativo', async () => {
    const g = await newGuild('Nadir Testers', 'NAD')
    await fire('weekly.objective_completed', { objective: 'active_week', week: '2026-W10' }, g,
      `wk-${sufixo}`)
    assert.equal(await prestigeOf(g), 250)
    const ev = await db.tx(c => emit(c, {
      channelId, guildId: g, type: 'prestige.manual_adjust',
      payload: { amount: -5000, reason: 'teste' },
    }))
    await db.tx(c => mod.applyPrestige(c, {
      ...ev, channel_id: channelId, guild_id: g, season_id: seasonId,
      type: 'prestige.manual_adjust', payload: { amount: -5000 },
    }))
    assert.equal(await prestigeOf(g), 0)
  })
 
  test('R2: recompute reproduz o mesmo Prestígio de todas as guildas', async () => {
    const antes = { a: await prestigeOf(guilds.a), b: await prestigeOf(guilds.b) }
    await db.query('UPDATE guild_season_prestige SET prestige = 999999 WHERE season_id = $1',
      [seasonId])
    await db.tx(c => mod.recomputeSeason(c, seasonId))
    assert.equal(await prestigeOf(guilds.a), antes.a)
    assert.equal(await prestigeOf(guilds.b), antes.b)
  })
 
  test('R13: banir tira do snapshot sem apagar o Prestígio; desbanir traz de volta', async () => {
    const prestigio = await prestigeOf(guilds.a)
    await db.query("UPDATE guild SET status = 'banned' WHERE id = $1", [guilds.a])
    const banido = await db.tx(c => mod.takeSnapshot(c, seasonId))
    const { rows: fora } = await db.query(
      'SELECT 1 FROM ranking_snapshot_row WHERE snapshot_id = $1 AND guild_id = $2',
      [banido, guilds.a])
    assert.equal(fora.length, 0)
    assert.equal(await prestigeOf(guilds.a), prestigio)
 
    await db.query("UPDATE guild SET status = 'active' WHERE id = $1", [guilds.a])
    const voltou = await db.tx(c => mod.takeSnapshot(c, seasonId))
    const { rows: [row] } = await db.query(
      'SELECT prestige FROM ranking_snapshot_row WHERE snapshot_id = $1 AND guild_id = $2',
      [voltou, guilds.a])
    assert.equal(row.prestige, prestigio)
  })
 
  test('o snapshot dá posições distintas e contíguas', async () => {
    const id = await db.tx(c => mod.takeSnapshot(c, seasonId))
    const { rows } = await db.query(
      'SELECT position FROM ranking_snapshot_row WHERE snapshot_id = $1 ORDER BY position', [id])
    assert.deepEqual(rows.map(r => r.position), rows.map((_, i) => i + 1))
  })
 
  test('Exército: o 20º membro concede, e voltar a 20 não gera segunda linha', async () => {
    const g = await newGuild('Horda Testers', 'HOR')
    for (let i = 0; i < 19; i++) {
      await db.query(
        'INSERT INTO guild_member (guild_id, user_id, channel_id, role) VALUES ($1, $2, $3, $4)',
        [g, `h${i}-${sufixo}`, channelId, i === 0 ? 'leader' : 'member'])
    }
    assert.deepEqual(await db.tx(c => mod.evaluateGuild(c, channelId, g)), [])
 
    await db.query(
      'INSERT INTO guild_member (guild_id, user_id, channel_id, role) VALUES ($1, $2, $3, $4)',
      [g, `h19-${sufixo}`, channelId, 'member'])
    assert.deepEqual(await db.tx(c => mod.evaluateGuild(c, channelId, g)), ['army'])
    // R17/R18: reavaliar não concede de novo.
    assert.deepEqual(await db.tx(c => mod.evaluateGuild(c, channelId, g)), [])
 
    const { rows } = await db.query(
      "SELECT payload FROM guild_event WHERE guild_id = $1 AND type = 'achievement.unlocked'", [g])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].payload.rarity, 'rare')
  })
 
  test('R19: Primeiro Sangue vai para uma guilda só no canal por temporada', async () => {
    await fire('event.win', { event_id: `fb-b-${sufixo}` }, guilds.b, `fb-b-${sufixo}`)
    const primeira = await db.tx(c => mod.evaluateGuild(c, channelId, guilds.a))
    assert.ok(primeira.includes('first_blood'), 'a vitória mais antiga é da guilda A')
    const segunda = await db.tx(c => mod.evaluateGuild(c, channelId, guilds.b))
    assert.equal(segunda.includes('first_blood'), false)
  })
 
  test('o backfill é idempotente: a segunda execução não cria linha', async () => {
    const antes = (await db.query('SELECT count(*)::int AS n FROM guild_achievement')).rows[0].n
    await mod.backfillAchievements({ log: { error: () => {} } })
    const depois = (await db.query('SELECT count(*)::int AS n FROM guild_achievement')).rows[0].n
    await mod.backfillAchievements({ log: { error: () => {} } })
    assert.equal((await db.query('SELECT count(*)::int AS n FROM guild_achievement')).rows[0].n,
      depois)
    assert.ok(depois >= antes)
  })
 
  test('virada: freezing, a seguinte já ativa e apuração com pódio', async () => {
    await db.query(
      "UPDATE season SET ends_at = now() - interval '2 hours' WHERE id = $1", [seasonId])
    await mod.runSeasonLifecycle({ log: { error: () => {} } })
 
    const { rows: [antiga] } = await db.query('SELECT * FROM season WHERE id = $1', [seasonId])
    assert.equal(antiga.status, 'closed')
    const { rows: [nova] } = await db.query(
      "SELECT * FROM season WHERE channel_id = $1 AND status = 'active'", [channelId])
    assert.ok(nova, 'a temporada seguinte já está ativa durante a apuração (R9)')
    assert.equal(+new Date(nova.starts_at), +new Date(antiga.ends_at))
 
    const { rows: finais } = await db.query(
      'SELECT * FROM ranking_snapshot WHERE season_id = $1 AND is_final', [seasonId])
    assert.equal(finais.length, 1)
    const { rows: podio } = await db.query(
      'SELECT * FROM season_award WHERE season_id = $1 ORDER BY position', [seasonId])
    assert.ok(podio.length >= 1 && podio.length <= 3)
    assert.deepEqual(podio.map(p => p.position), podio.map((_, i) => i + 1))
    assert.equal(new Set(podio.map(p => p.guild_id)).size, podio.length)
 
    const { rows: eventos } = await db.query(
      "SELECT type FROM guild_event WHERE channel_id = $1 AND type IN ('season.started','season.ended')",
      [channelId])
    assert.ok(eventos.some(e => e.type === 'season.ended'))
    assert.ok(eventos.some(e => e.type === 'season.started'))
 
    // R12: rodar de novo não muda o pódio.
    await mod.runSeasonLifecycle({ log: { error: () => {} } })
    const { rows: outra } = await db.query(
      'SELECT * FROM season_award WHERE season_id = $1 ORDER BY position', [seasonId])
    assert.deepEqual(outra.map(p => p.guild_id), podio.map(p => p.guild_id))
  })
 
  test('a temporada nova nasce zerada e a antiga continua legível', async () => {
    const { rows: [nova] } = await db.query(
      "SELECT * FROM season WHERE channel_id = $1 AND status = 'active'", [channelId])
    assert.equal(await prestigeOf(guilds.a, nova.id), 0)
    assert.ok(await prestigeOf(guilds.a, seasonId) > 0, 'o Prestígio da temporada passada fica')
    const { rows: [g] } = await db.query('SELECT level, xp FROM guild WHERE id = $1', [guilds.a])
    assert.equal(g.level, 1)   // virada não mexe em nível nem XP
  })
})
 