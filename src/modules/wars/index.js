import { query, tx } from '../../core/db.js'
import { emit, audit } from '../../core/events.js'
import { AppError, badRequest, conflict, forbidden, notFound } from '../../core/errors.js'
import { requireModerator } from '../../core/auth.js'
import { can } from '../members/permissions.js'
// Só leitura das tabelas puras da fase 04: é o que permite creditar EXATAMENTE o
// Prestígio do §5 sem hardcodar os números do vizinho (ver `creditPrestige`).
import { participateTotal, prestigeFor, weekRange } from '../seasons/prestige.js'
import {
  FORMATS, OPEN_STATES, SETTLE_GRACE_MS, assertTransition, challengeExpiresAt, isFormat,
  isOfflineFor, settleDueAt, specialWindowError, warWindow,
} from './machine.js'
import {
  GHOST_BLOCK_MS, GHOST_LIMIT, GHOST_WINDOW_MS, PAIR_COOLDOWN_MS,
  REPEAT_WINDOW_MS, TERRITORY_GHOST_LIMIT, WP_TYPES,
  grantWp, prestigeAwards, prestigeMultiplier, publicWpTable, resolveWar,
  rosterSize, rosterTooSmall, utcDay,
} from './scoring.js'
import { boardBytes, buildBoard } from './board.js'

const unprocessable = (code, msg, data) => new AppError(422, code, msg, data)

/**
 * Fase 05 — Guerras e Territórios. Produz `war.*`, `territory.*`, `dispute.*` e
 * é o gerador robusto de `event.win` / `event.placement` / `event.participate`
 * que a fase 04 consome (README §Duas ressalvas de ordem).
 *
 * A matemática está em machine.js / scoring.js / board.js, que são puros. Aqui
 * só vive o que precisa de banco.
 */

const num = (v) => Number(v) || 0
const DAY_MS = 86_400_000
const PROTECTION_MS = 48 * 60 * 60_000        // R18
const TERRITORY_CAP = 4                       // R22
const CHANNEL_TERRITORY_CAP = 12              // R22
const INACTIVITY_MS = 14 * DAY_MS             // R20
/** Guilda continua guerreando; `overflow` é guilda ativa cheia, não punição. */
const ALIVE_STATUS = ['active', 'overflow']

// ------------------------------------------------------------------- leitura

function requireUser (auth) {
  if (!auth.userId) throw forbidden('IDENTITY_REQUIRED', 'requer consentimento de identidade')
  return auth.userId
}

async function getWar (client, channelId, id) {
  const { rows } = await client.query(
    'SELECT * FROM war WHERE id = $1 AND channel_id = $2', [num(id), channelId])
  if (!rows[0]) throw notFound('WAR_NOT_FOUND', 'guerra não encontrada')
  return rows[0]
}

async function lockWar (client, channelId, id) {
  const { rows } = await client.query(
    'SELECT * FROM war WHERE id = $1 AND channel_id = $2 FOR UPDATE', [num(id), channelId])
  if (!rows[0]) throw notFound('WAR_NOT_FOUND', 'guerra não encontrada')
  return rows[0]
}

/** A guilda do ator e o cargo dele nela. R2 decide o resto. */
async function actorGuild (client, channelId, userId) {
  const { rows } = await client.query(
    `SELECT g.*, m.role FROM guild_member m JOIN guild g ON g.id = m.guild_id
      WHERE m.channel_id = $1 AND m.user_id = $2`, [channelId, userId])
  if (!rows[0]) throw forbidden('NOT_IN_GUILD', 'viewer não pertence a nenhuma guilda')
  return rows[0]
}

/** R2 — declarar, aceitar, recusar e editar roster: só leader e officer. */
function requireWarRole (guild) {
  if (!can(guild.role, 'war_declare')) {
    throw forbidden('WAR_FORBIDDEN_ROLE', 'requer leader ou officer')
  }
  return guild
}

const requireActive = (guild) => {
  if (guild.status !== 'active') throw conflict('GUILD_NOT_ACTIVE', 'guilda não está ativa')
  return guild
}

async function guildByTag (client, channelId, tag) {
  const { rows } = await client.query(
    "SELECT * FROM guild WHERE channel_id = $1 AND upper(tag) = upper($2) AND status <> 'purged'",
    [channelId, String(tag ?? '')])
  if (!rows[0]) throw notFound('GUILD_NOT_FOUND', 'guilda não encontrada')
  return rows[0]
}

/**
 * Membros ordenados por atividade dos últimos 7 dias — a ordem do auto-preenchimento
 * do roster (§6). `active` é quem tem pelo menos um `guild_event` na janela.
 */
async function membersByActivity (client, channelId, guildId) {
  const { rows } = await client.query(
    `SELECT m.user_id, m.role, coalesce(a.n, 0)::int AS events
       FROM guild_member m
       LEFT JOIN LATERAL (
         SELECT count(*) AS n FROM guild_event e
          WHERE e.channel_id = $1 AND e.actor_user_id = m.user_id
            AND e.created_at > now() - interval '7 days') a ON true
      WHERE m.guild_id = $2
      ORDER BY coalesce(a.n, 0) DESC, m.joined_at`, [channelId, guildId])
  return { rows, active: rows.filter(r => r.events > 0).length }
}

// -------------------------------------------------------------- slot e travas

/** R1 — a PK de war_slot é a trava. Violação vira o 409 do doc. */
async function takeSlot (client, channelId, guildId, { warId = null, disputeId = null }) {
  try {
    await client.query(
      'INSERT INTO war_slot (channel_id, guild_id, war_id, dispute_id) VALUES ($1, $2, $3, $4)',
      [channelId, guildId, warId, disputeId])
  } catch (err) {
    if (err.code === '23505') {
      throw conflict('GUILD_WAR_SLOT_TAKEN', 'guilda já está em guerra ou disputa')
    }
    throw err
  }
}

const freeSlots = (client, warId) => client.query('DELETE FROM war_slot WHERE war_id = $1', [warId])

/** R5 — 3 desafios expirados em 7 dias bloqueiam declarar por 72 h. */
async function assertNotGhosting (client, guildId) {
  const { rows: [r] } = await client.query(
    `SELECT count(*)::int AS n, max(challenge_expires_at) AS last FROM war
      WHERE defender_guild_id = $1 AND status = 'expired'
        AND challenge_expires_at > now() - ($2::text || ' ms')::interval`,
    [guildId, String(GHOST_WINDOW_MS)])
  if (r.n >= GHOST_LIMIT && +new Date(r.last) + GHOST_BLOCK_MS > Date.now()) {
    throw conflict('WAR_BLOCKED_GHOSTING', 'guilda bloqueada por não responder desafios',
      { blocked_until: new Date(+new Date(r.last) + GHOST_BLOCK_MS) })
  }
}

/** R6 — 24 h entre guerras da mesma dupla. Guerra cancelada não conta (R13). */
async function assertPairCooldown (client, a, b) {
  const { rows: [r] } = await client.query(
    `SELECT max(closed_at) AS last FROM war
      WHERE status <> 'cancelled'
        AND ((challenger_guild_id = $1 AND defender_guild_id = $2)
          OR (challenger_guild_id = $2 AND defender_guild_id = $1))`, [a, b])
  if (r.last && +new Date(r.last) + PAIR_COOLDOWN_MS > Date.now()) {
    throw conflict('WAR_COOLDOWN_PAIR', 'a mesma dupla espera 24 h entre guerras',
      { retry_after: new Date(+new Date(r.last) + PAIR_COOLDOWN_MS) })
  }
}

// ------------------------------------------------------------------ território

const currentHolding = async (client, territoryId) => {
  const { rows } = await client.query(
    'SELECT * FROM territory_holding WHERE territory_id = $1 AND released_at IS NULL',
    [territoryId])
  return rows[0] ?? null
}

async function heldCount (client, guildId) {
  const { rows: [r] } = await client.query(
    `SELECT count(*)::int AS n FROM territory_holding
      WHERE guild_id = $1 AND released_at IS NULL`, [guildId])
  return r.n
}

async function assertTerritoryRoom (client, guildId) {
  if (await heldCount(client, guildId) >= TERRITORY_CAP) {         // R22
    throw conflict('TERRITORY_CAP_REACHED', `teto de ${TERRITORY_CAP} territórios por guilda`)
  }
}

async function releaseHolding (client, holding, reason) {
  const { rowCount } = await client.query(
    `UPDATE territory_holding SET released_at = now(), release_reason = $2
      WHERE id = $1 AND released_at IS NULL`, [holding.id, reason])
  if (!rowCount) return null
  await emit(client, {
    channelId: holding.channel_id,
    guildId: holding.guild_id,
    type: 'territory.lost',
    payload: { territory_id: holding.territory_id, previous_guild_id: holding.guild_id, reason },
  })
  return holding
}

/**
 * R17 — território muda de dono só por guerra `special` com stake, por disputa,
 * ou pela mão do broadcaster. Sempre libera o dono anterior na mesma transação;
 * `territory_current_owner` (índice parcial) é quem garante um dono só.
 */
async function captureTerritory (client, { channelId, territoryId, guildId, via, warId = null, disputeId = null, releaseReason }) {
  const previous = await currentHolding(client, territoryId)
  if (previous) {
    if (previous.guild_id === guildId) {
      // Defensor manteve a posse: renova a proteção (§8) em vez de trocar de dono.
      await client.query(
        'UPDATE territory_holding SET protected_until = now() + $2::interval WHERE id = $1',
        [previous.id, `${PROTECTION_MS} ms`])
      return previous
    }
    // R22 antes de liberar: se o vencedor está no teto, a posse não muda de mão —
    // liberar primeiro deixaria o território neutro por engano.
    if (await heldCount(client, guildId) >= TERRITORY_CAP) return null
    await releaseHolding(client, previous, releaseReason)
  } else if (await heldCount(client, guildId) >= TERRITORY_CAP) {
    return null
  }

  const { rows: [holding] } = await client.query(
    `INSERT INTO territory_holding
       (territory_id, guild_id, channel_id, acquired_via, source_war_id, source_dispute_id, protected_until)
     VALUES ($1, $2, $3, $4, $5, $6, now() + $7::interval) RETURNING *`,
    [territoryId, guildId, channelId, via, warId, disputeId, `${PROTECTION_MS} ms`])
  await emit(client, {
    channelId,
    guildId,
    type: 'territory.captured',
    payload: { territory_id: territoryId, previous_guild_id: previous?.guild_id ?? null },
  })
  return holding
}

// ------------------------------------------------------------------- prestígio

/**
 * Credita o Prestígio do §5 pela fase 04, sem duplicar o ledger dela.
 *
 * A guerra emite `event.win` / `event.placement` / `event.participate` — que a
 * fase 04 já pontua com os valores DELA (500 / 300 / 10 por membro). O §5 desta
 * fase fecha outros números (150/40/80, 500/120/250, 900/200/450) e ainda aplica
 * o multiplicador do R11. O ajuste abaixo lança só a DIFERENÇA, de modo que o
 * total creditado seja exatamente `prestige_awarded`. A ordem importa: os eventos
 * de vitória entram antes do ajuste, e o handler da fase 04 processa por
 * (created_at, id) — nunca o ajuste primeiro.
 */
async function creditPrestige (client, war, awards, rosterSizeN) {
  const sides = [
    { guildId: war.challenger_guild_id, opponent: war.defender_guild_id },
    { guildId: war.defender_guild_id, opponent: war.challenger_guild_id },
  ]
  const eventId = `war:${war.id}`

  for (const s of sides) {
    const won = String(war.winner_guild_id ?? '') === String(s.guildId)
    const type = won ? 'event.win' : 'event.placement'
    const payload = won ? { event_id: eventId } : { event_id: eventId, rank: 2 }
    await emit(client, {
      channelId: war.channel_id,
      guildId: s.guildId,
      type,
      payload,
      externalId: `${eventId}:${s.guildId}`,
    })
  }

  // Participação individual: rende XP ao membro (fase 03) e conta para o
  // Prestígio de participação da fase 04, com o teto de 20 membros dela.
  const { rows: roster } = await client.query(
    'SELECT guild_id, user_id FROM war_roster WHERE war_id = $1', [war.id])
  for (const r of roster) {
    await emit(client, {
      channelId: war.channel_id,
      guildId: r.guild_id,
      type: 'event.participate',
      payload: { event_id: eventId, user_id: r.user_id },
      actorUserId: r.user_id,
      externalId: `${eventId}:${r.user_id}`,
    })
  }

  for (const s of sides) {
    const won = String(war.winner_guild_id ?? '') === String(s.guildId)
    const base = prestigeFor(won ? 'event.win' : 'event.placement', { rank: 2 })
      + participateTotal(rosterSizeN)
    const delta = (awards[s.guildId] ?? 0) - base
    if (!delta) continue
    // Só o evento: quem credita é o handler da fase 04, que processa por
    // (created_at, id) — o ajuste nasce depois da vitória e nunca antes dela.
    await emit(client, {
      channelId: war.channel_id,
      guildId: s.guildId,
      type: 'war.prestige_awarded',
      payload: { amount: delta, war_id: war.id },
      externalId: `${eventId}:adjust:${s.guildId}`,
    })
  }
}

// ---------------------------------------------------------- ciclo da guerra

/** Placar de verdade: a soma de `war_point` (R16). O contador incremental é cache. */
async function recomputeScore (client, war) {
  const { rows } = await client.query(
    `SELECT guild_id, coalesce(sum(points), 0)::int AS wp FROM war_point
      WHERE war_id = $1 GROUP BY guild_id`, [war.id])
  const of = (gid) => rows.find(r => r.guild_id === gid)?.wp ?? 0
  const { rows: [updated] } = await client.query(
    `UPDATE war SET score_challenger = $2, score_defender = $3,
            score_seq = score_seq + 1, score_updated_at = now()
      WHERE id = $1 RETURNING *`,
    [war.id, of(war.challenger_guild_id), of(war.defender_guild_id)])
  return updated
}

async function endWar (client, war, reason = 'ends_at') {
  assertTransition(war.status, 'ended')
  const scored = await recomputeScore(client, war)
  const { rows: [ended] } = await client.query(
    `UPDATE war SET status = 'ended', ended_at = now(), closed_at = now()
      WHERE id = $1 RETURNING *`, [war.id])
  await freeSlots(client, war.id)                     // `ended` não é estado aberto (R1)
  await emit(client, {
    channelId: war.channel_id,
    guildId: war.challenger_guild_id,
    type: 'war.ended',
    payload: {
      war_id: war.id,
      winner_guild_id: null,
      reason,
      score: { challenger: scored.score_challenger, defender: scored.score_defender },
    },
  })
  return ended
}

/** R11(b) — guerras já apuradas COM Prestígio pela guilda nesta semana ISO. */
async function settledThisWeek (client, guildId, at) {
  const { start, end } = weekRange(at)
  const { rows: [r] } = await client.query(
    `SELECT count(*)::int AS n FROM war
      WHERE status = 'settled' AND prestige_multiplier > 0
        AND settled_at >= $2 AND settled_at < $3
        AND (challenger_guild_id = $1 OR defender_guild_id = $1)`, [guildId, start, end])
  return r.n
}

/** R11(a) — a mesma dupla já apurou nos últimos 14 dias? */
async function pairRepeated (client, war) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM war
      WHERE id <> $3 AND status = 'settled'
        AND settled_at > now() - ($4::text || ' ms')::interval
        AND ((challenger_guild_id = $1 AND defender_guild_id = $2)
          OR (challenger_guild_id = $2 AND defender_guild_id = $1))`,
    [war.challenger_guild_id, war.defender_guild_id, war.id, String(REPEAT_WINDOW_MS)])
  return rowCount > 0
}

/** WP do último dia da guerra — desempate do `special` (§5). */
async function lastDayScores (client, war) {
  const { rows } = await client.query(
    `SELECT guild_id, coalesce(sum(points), 0)::int AS wp FROM war_point
      WHERE war_id = $1 AND created_at >= $2::timestamptz - interval '1 day'
      GROUP BY guild_id`, [war.id, war.ends_at])
  return (gid) => rows.find(r => r.guild_id === gid)?.wp ?? 0
}

/**
 * Apuração (job war:settle). Placar reconferido, resultado, multiplicador
 * anti-conluio, Prestígio e território — tudo numa transação só.
 */
async function settleWar (client, war) {
  const scored = await recomputeScore(client, war)
  const lastDay = war.format === 'special' ? await lastDayScores(client, war) : () => 0
  const sideOf = async (gid, score) => ({
    guildId: gid,
    score,
    territories: war.format === 'special' ? await heldCount(client, gid) : 0,
    lastDayScore: lastDay(gid),
  })

  const result = resolveWar({
    format: war.format,
    challenger: await sideOf(war.challenger_guild_id, scored.score_challenger),
    defender: await sideOf(war.defender_guild_id, scored.score_defender),
  })
  assertTransition(war.status, result.status)

  if (result.status === 'no_contest') {                                    // R8
    const awarded = prestigeAwards(war.format, {
      challengerGuildId: war.challenger_guild_id,
      defenderGuildId: war.defender_guild_id,
      noContest: true,
    })
    const { rows: [done] } = await client.query(
      `UPDATE war SET status = 'no_contest', settled_at = now(),
              prestige_multiplier = 0, prestige_awarded = $2
        WHERE id = $1 RETURNING *`, [war.id, awarded])
    await emit(client, {
      channelId: war.channel_id,
      guildId: war.challenger_guild_id,
      type: 'war.settled',
      payload: {
        war_id: war.id,
        winner_guild_id: null,
        outcome: 'no_contest',
        score: { challenger: scored.score_challenger, defender: scored.score_defender },
      },
    })
    return done
  }

  // O teto semanal do R11(b) é POR GUILDA: a guilda que já apurou 2 nesta semana
  // sai com 0 sem zerar o outro lado, que pode estar na primeira guerra da semana.
  const repeatedPair = await pairRepeated(client, war)
  const sides = [war.challenger_guild_id, war.defender_guild_id]
  const multipliers = []
  for (const gid of sides) {
    multipliers.push(prestigeMultiplier({
      repeatedPair,
      settledThisWeek: await settledThisWeek(client, gid, new Date()),
    }))
  }
  const awarded = Object.fromEntries(sides.map((gid, i) => [gid, prestigeAwards(war.format, {
    challengerGuildId: war.challenger_guild_id,
    defenderGuildId: war.defender_guild_id,
    winnerGuildId: result.winnerGuildId,
    multiplier: multipliers[i],
  })[gid]]))
  const multiplier = Math.min(...multipliers)   // a coluna guarda o pior dos dois

  const { rows: [done] } = await client.query(
    `UPDATE war SET status = 'settled', settled_at = now(), winner_guild_id = $2,
            prestige_multiplier = $3, prestige_awarded = $4
      WHERE id = $1 RETURNING *`,
    [war.id, result.winnerGuildId, multiplier, awarded])

  await creditPrestige(client, done, awarded, done.roster_size)

  // R17/R14 — só `special` com stake troca território; empate mantém e renova.
  if (war.stake_territory_id) {
    const keeper = result.winnerGuildId ?? war.defender_guild_id
    await captureTerritory(client, {
      channelId: war.channel_id,
      territoryId: war.stake_territory_id,
      guildId: keeper,
      via: 'war',
      warId: war.id,
      releaseReason: 'lost_war',
    })
  }

  await emit(client, {
    channelId: war.channel_id,
    guildId: result.winnerGuildId ?? war.challenger_guild_id,
    type: 'war.settled',
    payload: {
      war_id: war.id,
      winner_guild_id: result.winnerGuildId,
      outcome: result.winnerGuildId ? 'win' : 'draw',
      prestige_awarded: awarded,
      prestige_multiplier: multiplier,
      score: { challenger: scored.score_challenger, defender: scored.score_defender },
    },
  })
  return done
}

/** Cancelamento (R13/R15): 0 Prestígio, território parado, não conta R6 nem R11. */
async function cancelWar (client, war, reason) {
  assertTransition(war.status, 'cancelled')
  const { rows: [done] } = await client.query(
    `UPDATE war SET status = 'cancelled', cancel_reason = $2, closed_at = now(),
            prestige_multiplier = 0
      WHERE id = $1 RETURNING *`, [war.id, reason])
  await freeSlots(client, war.id)
  await emit(client, {
    channelId: war.channel_id,
    guildId: war.challenger_guild_id,
    type: 'war.ended',
    payload: {
      war_id: war.id,
      winner_guild_id: null,
      reason: `cancelled:${reason}`,
      score: { challenger: war.score_challenger, defender: war.score_defender },
    },
  })
  return done
}

// ---------------------------------------------------------------------- rotas

export default async function wars (app) {
  app.get('/wars/points-table', async () => publicWpTable())

  /** POST /wars — desafio. A ordem das checagens é a ordem dos erros do §10. */
  app.post('/wars', async (req, reply) => tx(async (c) => {
    const userId = requireUser(req.auth)
    const cid = req.auth.channelId
    const format = String(req.body?.format ?? 'skirmish')
    if (!isFormat(format)) throw badRequest('WAR_FORMAT_INVALID', 'formato desconhecido')

    const challenger = requireActive(requireWarRole(await actorGuild(c, cid, userId)))
    const defender = await guildByTag(c, cid, req.body?.defender_tag)
    if (defender.id === challenger.id) {
      throw badRequest('WAR_SELF_CHALLENGE', 'guilda não desafia a si mesma')
    }
    requireActive(defender)                                                // R3

    await assertNotGhosting(c, challenger.id)                              // R5
    await assertPairCooldown(c, challenger.id, defender.id)                // R6

    // Janela: `special` traz a do broadcaster; os outros derivam do aceite.
    let window = { startsAt: null, endsAt: null }
    if (format === 'special') {
      const opensAt = req.body?.opens_at ?? new Date(Date.now() + 24 * 3_600_000)
      const closesAt = req.body?.closes_at ?? new Date(+new Date(opensAt) + 7 * DAY_MS)
      const bad = specialWindowError(opensAt, closesAt)
      if (bad) throw badRequest(bad, 'janela do special é de 1 a 14 dias')
      window = warWindow('special', { opensAt, closesAt })
    }

    const stakeId = req.body?.stake_territory_id ? num(req.body.stake_territory_id) : null
    if (stakeId) {
      if (!FORMATS[format].allowsStake) {
        throw badRequest('WAR_STAKE_NOT_ALLOWED', 'só o formato special disputa território')
      }
      const { rows: [t] } = await c.query(
        'SELECT * FROM territory WHERE id = $1 AND channel_id = $2 AND enabled', [stakeId, cid])
      if (!t) throw notFound('TERRITORY_NOT_FOUND', 'território não encontrado')
      const holding = await currentHolding(c, stakeId)
      if (!holding || holding.guild_id !== defender.id) {
        throw conflict('TERRITORY_NOT_HELD_BY_DEFENDER', 'território não é da desafiada')
      }
      if (+new Date(holding.protected_until) > Date.now()) {               // R18
        throw conflict('TERRITORY_PROTECTED', 'território em proteção de 48 h',
          { protected_until: holding.protected_until })
      }
      await assertTerritoryRoom(c, challenger.id)                          // R22
    }

    const a = await membersByActivity(c, cid, challenger.id)
    const b = await membersByActivity(c, cid, defender.id)
    const size = rosterSize(a.active, b.active)                            // §6
    if (rosterTooSmall(size)) {
      throw unprocessable('WAR_ROSTER_TOO_SMALL',
        'as duas guildas precisam de 3 membros ativos nos últimos 7 dias',
        { roster_size: size })
    }

    const { rows: [war] } = await c.query(
      `INSERT INTO war (channel_id, format, challenger_guild_id, defender_guild_id,
                        stake_territory_id, roster_size, min_points, declared_by,
                        challenge_expires_at, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
      [cid, format, challenger.id, defender.id, stakeId, size, FORMATS[format].minPoints,
        userId, challengeExpiresAt(format), window.startsAt, window.endsAt])

    await takeSlot(c, cid, challenger.id, { warId: war.id })               // R1
    await takeSlot(c, cid, defender.id, { warId: war.id })
    await fillRoster(c, war, challenger.id, a.rows.slice(0, size).map(r => r.user_id), userId)
    await fillRoster(c, war, defender.id, b.rows.slice(0, size).map(r => r.user_id), userId)

    await emit(c, {
      channelId: cid,
      guildId: challenger.id,
      type: 'war.declared',
      payload: { war_id: war.id, opponent_guild_id: defender.id, format },
      actorUserId: userId,
    })
    reply.code(201)
    return war
  }))

  app.post('/wars/:id/accept', async (req) => tx(async (c) => {
    const userId = requireUser(req.auth)
    const cid = req.auth.channelId
    const war = await lockWar(c, cid, req.params.id)
    const guild = requireActive(requireWarRole(await actorGuild(c, cid, userId)))
    if (guild.id !== war.defender_guild_id) {
      throw forbidden('WAR_FORBIDDEN_ROLE', 'só a guilda desafiada responde')
    }
    if (war.status !== 'pending') throw conflict('WAR_NOT_PENDING', 'desafio já respondido')
    if (+new Date(war.challenge_expires_at) <= Date.now()) {
      throw conflict('WAR_EXPIRED', 'desafio expirado')
    }
    const { rows: [challenger] } = await c.query('SELECT status FROM guild WHERE id = $1',
      [war.challenger_guild_id])
    if (challenger?.status !== 'active') throw conflict('GUILD_NOT_ACTIVE', 'desafiante não está ativa')

    const window = war.format === 'special'
      ? { startsAt: war.starts_at, endsAt: war.ends_at }
      : warWindow(war.format, { acceptedAt: new Date() })

    // R12 — a guerra é da temporada vigente em ends_at e não pode atravessar o fecho.
    const { rows: [season] } = await c.query(
      `SELECT * FROM season WHERE channel_id = $1 AND status IN ('active','freezing')
        ORDER BY (status = 'active') DESC, starts_at DESC LIMIT 1`, [cid])
    if (season && +new Date(window.endsAt) > +new Date(season.ends_at)) {
      throw conflict('WAR_CROSSES_SEASON', 'a guerra terminaria depois do fim da temporada')
    }

    assertTransition(war.status, 'accepted')
    const { rows: [accepted] } = await c.query(
      `UPDATE war SET status = 'accepted', responded_by = $2, starts_at = $3, ends_at = $4,
              season_id = $5
        WHERE id = $1 RETURNING *`,
      [war.id, userId, window.startsAt, window.endsAt, season?.id ?? null])
    await emit(c, {
      channelId: cid,
      guildId: war.defender_guild_id,
      type: 'war.accepted',
      payload: { war_id: war.id, opponent_guild_id: war.challenger_guild_id, format: war.format },
      actorUserId: userId,
    })
    return accepted
  }))

  app.post('/wars/:id/decline', async (req) => tx(async (c) => {
    const userId = requireUser(req.auth)
    const cid = req.auth.channelId
    const war = await lockWar(c, cid, req.params.id)
    const guild = requireWarRole(await actorGuild(c, cid, userId))
    if (guild.id !== war.defender_guild_id) {
      throw forbidden('WAR_FORBIDDEN_ROLE', 'só a guilda desafiada responde')
    }
    if (war.status !== 'pending') throw conflict('WAR_NOT_PENDING', 'desafio já respondido')

    assertTransition(war.status, 'declined')
    const { rows: [declined] } = await c.query(
      `UPDATE war SET status = 'declined', responded_by = $2, closed_at = now()
        WHERE id = $1 RETURNING *`, [war.id, userId])
    await freeSlots(c, war.id)
    // R5: recusar é resposta legítima e não conta como ghosting.
    await emit(c, {
      channelId: cid,
      guildId: war.defender_guild_id,
      type: 'war.declined',
      payload: {
        war_id: war.id,
        opponent_guild_id: war.challenger_guild_id,
        format: war.format,
        reason: String(req.body?.reason ?? '').slice(0, 200) || null,
      },
      actorUserId: userId,
    })
    return declined
  }))

  app.put('/wars/:id/roster', async (req) => tx(async (c) => {
    const userId = requireUser(req.auth)
    const cid = req.auth.channelId
    const war = await lockWar(c, cid, req.params.id)
    const guild = requireWarRole(await actorGuild(c, cid, userId))
    if (![war.challenger_guild_id, war.defender_guild_id].includes(guild.id)) {
      throw forbidden('WAR_FORBIDDEN_ROLE', 'guilda não participa desta guerra')
    }
    if (!['pending', 'accepted'].includes(war.status)) {
      throw conflict('WAR_ROSTER_LOCKED', 'roster trava quando a guerra começa')
    }

    const ids = [...new Set((req.body?.user_ids ?? []).map(String))]
    if (ids.length !== war.roster_size) {
      throw unprocessable('WAR_ROSTER_SIZE_MISMATCH',
        `o roster tem exatamente ${war.roster_size} membros`)
    }
    const { rows: members } = await c.query(
      'SELECT user_id FROM guild_member WHERE guild_id = $1 AND user_id = ANY($2)',
      [guild.id, ids])
    if (members.length !== ids.length) {
      throw unprocessable('USER_NOT_GUILD_MEMBER', 'todos precisam ser membros da guilda')
    }

    await c.query('DELETE FROM war_roster WHERE war_id = $1 AND guild_id = $2', [war.id, guild.id])
    await fillRoster(c, war, guild.id, ids, userId)
    const { rows } = await c.query(
      'SELECT guild_id, user_id FROM war_roster WHERE war_id = $1 ORDER BY guild_id, user_id',
      [war.id])
    return { roster: rows }
  }))

  app.get('/wars/active', async (req) => {
    const cid = req.auth.channelId
    return (await boardForChannel(cid)).message
  })

  app.get('/wars/:id/score', async (req) => {
    const war = await getWar({ query }, req.auth.channelId, req.params.id)
    return {
      seq: war.score_seq,
      challenger: { guild_id: war.challenger_guild_id, score: war.score_challenger },
      defender: { guild_id: war.defender_guild_id, score: war.score_defender },
      status: war.status,
      updated_at: war.score_updated_at,
    }
  })

  app.get('/wars/:id', async (req) => {
    const war = await getWar({ query }, req.auth.channelId, req.params.id)
    const { rows: roster } = await query(
      'SELECT guild_id, user_id, locked_at FROM war_roster WHERE war_id = $1', [war.id])
    return { war, roster }
  })

  app.get('/wars', async (req) => {
    const limit = Math.min(Math.max(num(req.query.limit) || 20, 1), 50)
    const cursor = req.query.cursor ? num(req.query.cursor) : null
    const { rows } = await query(
      `SELECT * FROM war
        WHERE channel_id = $1
          AND ($2::bigint IS NULL OR challenger_guild_id = $2 OR defender_guild_id = $2)
          AND ($3::text IS NULL OR status::text = $3)
          AND ($4::bigint IS NULL OR id < $4)
        ORDER BY id DESC LIMIT $5`,
      [req.auth.channelId, req.query.guild_id ? num(req.query.guild_id) : null,
        req.query.status ?? null, cursor, limit])
    return { items: rows, next_cursor: rows.length === limit ? String(rows.at(-1).id) : null }
  })

  /** R15 — contestação: mod cancela guerra aberta, ou `ended` dentro de 10 min. */
  app.post('/wars/:id/cancel', async (req) => tx(async (c) => {
    requireModerator(req)
    const war = await lockWar(c, req.auth.channelId, req.params.id)
    const cancellable = OPEN_STATES.includes(war.status)
      || (war.status === 'ended' && Date.now() < +settleDueAt(war.ended_at))
    if (!cancellable) throw conflict('WAR_NOT_CANCELLABLE', 'guerra fora da janela de contestação')

    const reason = String(req.body?.reason ?? '').trim()
    if (!reason) throw badRequest('REASON_REQUIRED', 'reason obrigatório')
    const done = await cancelWar(c, war, reason)
    if (req.auth.userId) {
      await audit(c, {
        channelId: req.auth.channelId,
        actorUserId: req.auth.userId,
        action: 'war.cancel',
        target: `war:${war.id}`,
        before: { status: war.status },
        after: { reason },
      })
    }
    return done
  }))

  // ------------------------------------------------------------- territórios

  app.get('/territories', async (req) => {
    const { rows } = await query(
      `SELECT t.*, h.guild_id AS owner_guild_id, h.acquired_at, h.protected_until,
              g.name AS owner_name, g.tag AS owner_tag,
              d.id AS active_dispute_id, d.closes_at AS dispute_closes_at
         FROM territory t
         LEFT JOIN territory_holding h ON h.territory_id = t.id AND h.released_at IS NULL
         LEFT JOIN guild g ON g.id = h.guild_id
         LEFT JOIN territory_dispute d ON d.territory_id = t.id AND d.status = 'open'
        WHERE t.channel_id = $1 ORDER BY t.map_y, t.map_x, t.id`, [req.auth.channelId])
    return { items: rows }
  })

  app.post('/territories', async (req, reply) => tx(async (c) => {
    requireBroadcaster(req)
    const cid = req.auth.channelId
    const { rows: [count] } = await c.query(
      'SELECT count(*)::int AS n FROM territory WHERE channel_id = $1 AND enabled', [cid])
    if (count.n >= CHANNEL_TERRITORY_CAP) {                                 // R22
      throw conflict('TERRITORY_LIMIT_REACHED', `máximo de ${CHANNEL_TERRITORY_CAP} por canal`)
    }
    const t = territoryInput(req.body)
    const { rows: [row] } = await c.query(
      `INSERT INTO territory (channel_id, slug, name, map_x, map_y, art_key, prestige_per_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [cid, t.slug, t.name, t.map_x, t.map_y, t.art_key, t.prestige_per_day])
      .catch(dupTerritory)
    reply.code(201)
    return row
  }))

  app.patch('/territories/:id', async (req) => tx(async (c) => {
    requireBroadcaster(req)
    const cid = req.auth.channelId
    const { rows: [current] } = await c.query(
      'SELECT * FROM territory WHERE id = $1 AND channel_id = $2', [num(req.params.id), cid])
    if (!current) throw notFound('TERRITORY_NOT_FOUND', 'território não encontrado')
    const t = territoryInput({ ...current, ...req.body })
    const { rows: [row] } = await c.query(
      `UPDATE territory SET slug = $2, name = $3, map_x = $4, map_y = $5, art_key = $6,
              prestige_per_day = $7, enabled = $8
        WHERE id = $1 RETURNING *`,
      [current.id, t.slug, t.name, t.map_x, t.map_y, t.art_key, t.prestige_per_day,
        req.body?.enabled ?? current.enabled]).catch(dupTerritory)
    return row
  }))

  app.delete('/territories/:id', async (req, reply) => tx(async (c) => {
    requireBroadcaster(req)
    const cid = req.auth.channelId
    const id = num(req.params.id)
    const { rows: [busy] } = await c.query(
      `SELECT 1 FROM war w WHERE w.stake_territory_id = $1 AND w.status = ANY($2::war_status[])
        UNION ALL
       SELECT 1 FROM territory_dispute d WHERE d.territory_id = $1 AND d.status = 'open'`,
      [id, OPEN_STATES])
    if (busy) throw conflict('TERRITORY_IN_USE', 'território tem guerra ou disputa aberta')
    const { rowCount } = await c.query('DELETE FROM territory WHERE id = $1 AND channel_id = $2',
      [id, cid])
    if (!rowCount) throw notFound('TERRITORY_NOT_FOUND', 'território não encontrado')
    reply.code(204)
  }))

  /** R17 (exceção) — mão do broadcaster, sempre com audit_log. */
  app.post('/territories/:id/holdings', async (req) => tx(async (c) => {
    const actor = requireBroadcaster(req)
    const cid = req.auth.channelId
    const { rows: [t] } = await c.query(
      'SELECT * FROM territory WHERE id = $1 AND channel_id = $2', [num(req.params.id), cid])
    if (!t) throw notFound('TERRITORY_NOT_FOUND', 'território não encontrado')
    const reason = String(req.body?.reason ?? '').trim()
    if (!reason) throw badRequest('REASON_REQUIRED', 'reason obrigatório')

    const previous = await currentHolding(c, t.id)
    const guildId = req.body?.guild_id ? num(req.body.guild_id) : null
    let holding = null
    if (guildId) {
      await assertTerritoryRoom(c, guildId)
      holding = await captureTerritory(c, {
        channelId: cid,
        territoryId: t.id,
        guildId,
        via: 'admin',
        releaseReason: 'admin',
      })
    } else if (previous) {
      await releaseHolding(c, previous, 'admin')
    }
    await audit(c, {
      channelId: cid,
      actorUserId: actor,
      action: 'territory.holding',
      target: `territory:${t.id}`,
      before: { guild_id: previous?.guild_id ?? null },
      after: { guild_id: guildId, reason },
    })
    return holding ?? { territory_id: t.id, guild_id: null }
  }))

  app.post('/territories/:id/disputes', async (req, reply) => tx(async (c) => {
    requireModerator(req)
    const cid = req.auth.channelId
    const { rows: [t] } = await c.query(
      'SELECT * FROM territory WHERE id = $1 AND channel_id = $2 AND enabled',
      [num(req.params.id), cid])
    if (!t) throw notFound('TERRITORY_NOT_FOUND', 'território não encontrado')
    if (await currentHolding(c, t.id)) {                                    // R24
      throw conflict('TERRITORY_HELD', 'disputa só abre sobre território neutro')
    }
    const opensAt = new Date(req.body?.opens_at ?? Date.now())
    const closesAt = new Date(req.body?.closes_at ?? +opensAt + 2 * DAY_MS)
    if (!Number.isFinite(+opensAt) || !Number.isFinite(+closesAt) || +closesAt <= +opensAt) {
      throw unprocessable('DISPUTE_WINDOW_INVALID', 'janela inválida')
    }
    const dispute = await openDispute(c, {
      channelId: cid,
      territoryId: t.id,
      openedBy: req.auth.userId ?? 'broadcaster',
      opensAt,
      closesAt,
      minPoints: num(req.body?.min_points) || undefined,
    })
    reply.code(201)
    return dispute
  }))

  app.post('/disputes/:id/join', async (req) => tx(async (c) => {
    const userId = requireUser(req.auth)
    const cid = req.auth.channelId
    const guild = requireActive(requireWarRole(await actorGuild(c, cid, userId)))
    const { rows: [d] } = await c.query(
      'SELECT * FROM territory_dispute WHERE id = $1 AND channel_id = $2 FOR UPDATE',
      [num(req.params.id), cid])
    if (!d) throw notFound('DISPUTE_NOT_FOUND', 'disputa não encontrada')
    if (d.status !== 'open' || +new Date(d.closes_at) <= Date.now()) {
      throw conflict('DISPUTE_CLOSED', 'disputa encerrada')
    }
    const { rowCount } = await c.query(
      'SELECT 1 FROM territory_dispute_entry WHERE dispute_id = $1 AND guild_id = $2',
      [d.id, guild.id])
    if (rowCount) throw conflict('DISPUTE_ALREADY_JOINED', 'guilda já está na disputa')
    await assertTerritoryRoom(c, guild.id)                                  // R22
    await takeSlot(c, cid, guild.id, { disputeId: d.id })                   // R24 + R1

    const { rows: [entry] } = await c.query(
      'INSERT INTO territory_dispute_entry (dispute_id, guild_id) VALUES ($1, $2) RETURNING *',
      [d.id, guild.id])
    return entry
  }))

  app.get('/disputes/:id', async (req) => {
    const { rows: [d] } = await query(
      'SELECT * FROM territory_dispute WHERE id = $1 AND channel_id = $2',
      [num(req.params.id), req.auth.channelId])
    if (!d) throw notFound('DISPUTE_NOT_FOUND', 'disputa não encontrada')
    const { rows: entries } = await query(
      `SELECT e.guild_id, e.points, g.name, g.tag FROM territory_dispute_entry e
         JOIN guild g ON g.id = e.guild_id
        WHERE e.dispute_id = $1 ORDER BY e.points DESC, e.joined_at`, [d.id])
    return { dispute: d, entries }
  })

  app.get('/guilds/:id/members/eligibility', async (req) => {
    const gid = num(req.params.id)
    const { rows, active } = await membersByActivity({ query }, req.auth.channelId, gid)
    return {
      items: rows.map(r => ({
        user_id: r.user_id,
        role: r.role,
        events: r.events,
        is_eligible: r.events > 0,
      })),
      active_count: active,
    }
  })
}

// ------------------------------------------------------------------ auxiliares

function requireBroadcaster (req) {
  requireModerator(req)
  if (req.auth.role !== 'broadcaster') throw forbidden('FORBIDDEN', 'requer broadcaster')
  if (!req.auth.userId) throw forbidden('IDENTITY_REQUIRED', 'requer consentimento de identidade')
  return req.auth.userId
}

const slugify = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '').slice(0, 40)

function territoryInput (body = {}) {
  const name = String(body.name ?? '').trim()
  const slug = slugify(body.slug ?? name)
  const map_x = Math.trunc(Number(body.map_x))
  const map_y = Math.trunc(Number(body.map_y))
  const ppd = body.prestige_per_day === undefined ? 10 : Math.trunc(Number(body.prestige_per_day))
  if (!name || !slug) throw badRequest('TERRITORY_NAME_REQUIRED', 'name obrigatório')
  if (![map_x, map_y].every(v => Number.isFinite(v) && v >= 0 && v <= 1000)) {
    throw badRequest('TERRITORY_POSITION_INVALID', 'map_x e map_y ficam entre 0 e 1000')
  }
  if (!Number.isFinite(ppd) || ppd < 0 || ppd > 25) {
    throw badRequest('TERRITORY_PRESTIGE_INVALID', 'prestige_per_day de 0 a 25')
  }
  return { name, slug, map_x, map_y, art_key: body.art_key ?? null, prestige_per_day: ppd }
}

function dupTerritory (err) {
  if (err.code === '23505') throw conflict('TERRITORY_SLUG_TAKEN', 'slug ou nome já usado')
  throw err
}

async function fillRoster (client, war, guildId, userIds, addedBy) {
  for (const uid of userIds) {
    await client.query(
      `INSERT INTO war_roster (war_id, guild_id, user_id, added_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (war_id, user_id) DO NOTHING`, [war.id, guildId, uid, addedBy])
  }
}

async function openDispute (client, { channelId, territoryId, openedBy, opensAt, closesAt, minPoints }) {
  const { rows: [d] } = await client.query(
    `INSERT INTO territory_dispute
       (channel_id, territory_id, opened_by, opens_at, closes_at, min_points, season_id)
     VALUES ($1, $2, $3, $4, $5, coalesce($6::int, 300),
             (SELECT id FROM season WHERE channel_id = $1 AND status = 'active' LIMIT 1))
     RETURNING *`, [channelId, territoryId, openedBy, opensAt, closesAt, minPoints ?? null])
    .catch((err) => {
      if (err.code === '23505') throw conflict('DISPUTE_ALREADY_OPEN', 'já há disputa aberta')
      throw err
    })
  await emit(client, {
    channelId,
    type: 'dispute.opened',
    payload: { dispute_id: d.id, territory_id: territoryId, closes_at: d.closes_at },
  })
  return d
}

// ------------------------------------------------------------------- placar

/**
 * §7 — o agregado do canal. Também serve de reidratação em `GET /wars/active`,
 * para o cliente montar o mesmo shape que chega pelo PubSub.
 */
export async function boardForChannel (channelId) {
  const { rows } = await query(
    `SELECT w.id, w.format, w.ends_at, w.score_seq, w.score_challenger, w.score_defender,
            w.challenger_guild_id, w.defender_guild_id,
            c.tag AS challenger_tag, d.tag AS defender_tag
       FROM war w
       JOIN guild c ON c.id = w.challenger_guild_id
       JOIN guild d ON d.id = w.defender_guild_id
      WHERE w.channel_id = $1 AND w.status = 'active'
      ORDER BY w.score_updated_at DESC, w.id DESC`, [channelId])
  const seq = rows.reduce((acc, r) => acc + (Number(r.score_seq) || 0), 0)
  return buildBoard(rows, { channelId, seq })
}

/**
 * Transporte do §7. A integração real é um POST assinado em
 * `https://api.twitch.tv/helix/extensions/pubsub` com o Extension JWT do canal
 * (`role: external`, `pubsub_perms.send: ['broadcast']`) — fora desta entrega.
 * Deixado como função para o dia em que o segredo do PubSub existir: o payload
 * já sai pronto e dentro dos 5 KB de `buildBoard`.
 */
export async function publishBoard (message) {
  return { published: false, reason: 'pubsub_transport_not_configured', bytes: boardBytes(message) }
}

/** Job opcional (5 s): só publica se o placar mudou desde o último envio (§7). */
const lastSeq = new Map()
export async function broadcastBoards () {
  const { rows } = await query(
    "SELECT DISTINCT channel_id FROM war WHERE status = 'active'")
  let sent = 0
  for (const { channel_id: cid } of rows) {
    const { message } = await boardForChannel(cid)
    if (lastSeq.get(cid) === message.seq) continue
    lastSeq.set(cid, message.seq)
    await publishBoard(message)
    sent++
  }
  return { channels: rows.length, sent }
}

// --------------------------------------------------------------------- jobs

/**
 * Handler de WP: todo `guild_event` de membro do roster, dentro da janela da
 * guerra, que ainda não virou `war_point` (R7). `UNIQUE (war_id, event_id)`
 * é a idempotência (R16) — reprocessar a fila não dobra placar.
 *
 * ponytail: varredura por NOT EXISTS com janela de 2 dias, igual às fases 03/04.
 * Vira cursor persistido se `guild_event` passar dos milhões.
 */
export async function ingestWarPointsOnce ({ limit = 500, lookbackDays = 2, log = console } = {}) {
  const { rows } = await query(
    `SELECT e.id, e.channel_id, e.type, e.payload, e.actor_user_id, e.created_at,
            w.id AS war_id, w.challenger_guild_id, r.guild_id
       FROM guild_event e
       JOIN war w ON w.channel_id = e.channel_id AND w.status IN ('active','ended')
                 AND e.created_at >= w.starts_at AND e.created_at < w.ends_at
       JOIN war_roster r ON r.war_id = w.id AND r.user_id = e.actor_user_id
      WHERE e.type = ANY($1) AND e.actor_user_id IS NOT NULL
        AND e.created_at > now() - ($2::text || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM war_point p WHERE p.war_id = w.id AND p.event_id = e.id)
      ORDER BY e.created_at, e.id LIMIT $3`,
    [WP_TYPES, String(lookbackDays), limit])

  let posted = 0
  let points = 0
  let failed = 0
  for (const ev of rows) {
    try {
      const wp = await tx(c => applyWarPoint(c, ev))
      if (wp) { posted++; points += wp }
    } catch (err) {
      failed++
      log.error?.({ err, event: ev.id }, 'wars: evento não pontuado')
    }
  }
  const disputes = await recomputeDisputeScores({ log })
  return { scanned: rows.length, posted, points, failed, disputes }
}

/** Consumo do membro naquele dia UTC, na mesma guerra — base dos tetos do §6/R9. */
async function usageOf (client, warId, userId, day) {
  const { rows } = await client.query(
    `SELECT event_type, coalesce(sum(points), 0)::int AS wp FROM war_point
      WHERE war_id = $1 AND user_id = $2
        AND created_at >= ($3::date)::timestamp AT TIME ZONE 'UTC'
        AND created_at <  ($3::date + 1)::timestamp AT TIME ZONE 'UTC'
      GROUP BY event_type`, [warId, userId, day])
  return {
    total: rows.reduce((a, r) => a + r.wp, 0),
    bySource: Object.fromEntries(rows.map(r => [r.event_type, r.wp])),
  }
}

async function applyWarPoint (client, ev) {
  // Trava a guerra: serializa dois eventos concorrentes do mesmo membro no teto.
  await client.query('SELECT 1 FROM war WHERE id = $1 FOR UPDATE', [ev.war_id])
  const day = utcDay(ev.created_at)
  const used = await usageOf(client, ev.war_id, ev.actor_user_id, day)
  const points = grantWp(ev.type, ev.payload ?? {}, used)
  if (!points) return 0

  const { rows } = await client.query(
    `INSERT INTO war_point (war_id, guild_id, user_id, event_id, event_type, points, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (war_id, event_id) DO NOTHING RETURNING id`,
    [ev.war_id, ev.guild_id, ev.actor_user_id, ev.id, ev.type, points, ev.created_at])
  if (!rows[0]) return 0

  const column = ev.guild_id === ev.challenger_guild_id ? 'score_challenger' : 'score_defender'
  await client.query(
    `UPDATE war SET ${column} = ${column} + $2, score_seq = score_seq + 1,
            score_updated_at = now() WHERE id = $1`, [ev.war_id, points])
  return points
}

/**
 * Placar da disputa: mesma tabela de WP, mesmos tetos, sem roster (toda a guilda
 * conta). Recomputado a cada passada em vez de ter ledger próprio — a janela é de
 * no máximo 48 h e o recompute é idempotente por construção.
 * ponytail: O(entradas × eventos da janela); vira ledger se disputa virar rotina.
 */
export async function recomputeDisputeScores ({ log = console } = {}) {
  const { rows: entries } = await query(
    `SELECT d.id AS dispute_id, d.opens_at, d.closes_at, e.guild_id, d.channel_id
       FROM territory_dispute d JOIN territory_dispute_entry e ON e.dispute_id = d.id
      WHERE d.status = 'open'`)
  let updated = 0
  for (const e of entries) {
    try {
      const { rows: evs } = await query(
        `SELECT ev.type, ev.payload, ev.actor_user_id, ev.created_at
           FROM guild_event ev
           JOIN guild_member m ON m.channel_id = ev.channel_id AND m.user_id = ev.actor_user_id
          WHERE ev.channel_id = $1 AND m.guild_id = $2 AND ev.type = ANY($3)
            AND ev.created_at >= $4 AND ev.created_at < $5
          ORDER BY ev.created_at, ev.id`,
        [e.channel_id, e.guild_id, WP_TYPES, e.opens_at, e.closes_at])

      const used = new Map()
      let total = 0
      for (const ev of evs) {
        const key = `${ev.actor_user_id}:${utcDay(ev.created_at)}`
        const u = used.get(key) ?? { total: 0, bySource: {} }
        const wp = grantWp(ev.type, ev.payload ?? {}, u)
        if (!wp) continue
        u.total += wp
        u.bySource[ev.type] = (u.bySource[ev.type] ?? 0) + wp
        used.set(key, u)
        total += wp
      }
      await query('UPDATE territory_dispute_entry SET points = $3 WHERE dispute_id = $1 AND guild_id = $2',
        [e.dispute_id, e.guild_id, total])
      updated++
    } catch (err) {
      log.error?.({ err, dispute: e.dispute_id }, 'wars: placar de disputa não atualizado')
    }
  }
  return updated
}

/**
 * war:expire + war:start + war:end + war:settle numa passada só — as quatro são
 * a mesma varredura sobre `war` e o doc pede 60 s para todas.
 */
export async function runWarLifecycle ({ now = new Date(), log = console } = {}) {
  const out = { cancelled: 0, expired: 0, started: 0, ended: 0, settled: 0 }
  const step = async (key, warId, fn) => {
    try { await tx(fn); out[key]++ } catch (err) {
      log.error?.({ err, war: warId }, `wars: transição ${key} falhou`)
    }
  }

  // R13 — guilda banida/suspensa/dissolvida durante a guerra: 0 Prestígio para os dois.
  const { rows: dead } = await query(
    `SELECT DISTINCT ON (w.id) w.id, w.channel_id, g.status FROM war w
       JOIN guild g ON g.id IN (w.challenger_guild_id, w.defender_guild_id)
      WHERE w.status = ANY($1::war_status[]) AND NOT (g.status = ANY($2::guild_status[]))`,
    [OPEN_STATES, ALIVE_STATUS])
  for (const w of dead) {
    await step('cancelled', w.id, async (c) => {
      const war = await lockWar(c, w.channel_id, w.id)
      if (!OPEN_STATES.includes(war.status)) return
      await cancelWar(c, war, w.status === 'banned' ? 'guild_banned' : `guild_${w.status}`)
    })
  }

  // R4 — desafio sem resposta.
  const { rows: expired } = await query(
    "SELECT id, channel_id FROM war WHERE status = 'pending' AND challenge_expires_at <= $1",
    [now])
  for (const w of expired) {
    await step('expired', w.id, async (c) => {
      const war = await lockWar(c, w.channel_id, w.id)
      if (war.status !== 'pending') return
      assertTransition(war.status, 'expired')
      await c.query("UPDATE war SET status = 'expired', closed_at = now() WHERE id = $1", [war.id])
      await freeSlots(c, war.id)
    })
  }

  const liveAt = await lastLiveByChannel()

  // accepted → active, com roster conferido (§9).
  const { rows: starting } = await query(
    "SELECT id, channel_id, format FROM war WHERE status = 'accepted' AND starts_at <= $1", [now])
  for (const w of starting) {
    await step('started', w.id, async (c) => {
      const war = await lockWar(c, w.channel_id, w.id)
      if (war.status !== 'accepted') return
      // §7 — live caiu antes do começo: skirmish morre sem contar cooldown de par.
      if (FORMATS[war.format].endsOnOffline && isOfflineFor(liveAt.get(war.channel_id), now)) {
        await cancelWar(c, war, 'stream_offline')
        return
      }
      const { rows: sides } = await c.query(
        'SELECT guild_id, count(*)::int AS n FROM war_roster WHERE war_id = $1 GROUP BY guild_id',
        [war.id])
      if (sides.length !== 2 || sides.some(s => s.n !== war.roster_size)) {
        await cancelWar(c, war, 'roster_incomplete')
        return
      }
      assertTransition(war.status, 'active')
      await c.query("UPDATE war SET status = 'active' WHERE id = $1", [war.id])
      await c.query('UPDATE war_roster SET locked_at = now() WHERE war_id = $1', [war.id])
      await emit(c, {
        channelId: war.channel_id,
        guildId: war.challenger_guild_id,
        type: 'war.started',
        payload: { war_id: war.id, winner_guild_id: null, score: { challenger: 0, defender: 0 } },
      })
    })
  }

  // active → ended (ends_at, ou 15 min de live offline no skirmish).
  const { rows: running } = await query(
    "SELECT id, channel_id, format, ends_at FROM war WHERE status = 'active'")
  for (const w of running) {
    const due = +new Date(w.ends_at) <= +now
    const offline = FORMATS[w.format].endsOnOffline && isOfflineFor(liveAt.get(w.channel_id), now)
    if (!due && !offline) continue
    await step('ended', w.id, async (c) => {
      const war = await lockWar(c, w.channel_id, w.id)
      if (war.status !== 'active') return
      await endWar(c, war, due ? 'ends_at' : 'stream_offline')
    })
  }

  // ended → settled | no_contest, depois da janela de contestação (R15).
  const { rows: settling } = await query(
    "SELECT id, channel_id FROM war WHERE status = 'ended' AND ended_at <= $1",
    [new Date(+now - SETTLE_GRACE_MS)])
  for (const w of settling) {
    await step('settled', w.id, async (c) => {
      const war = await lockWar(c, w.channel_id, w.id)
      if (war.status !== 'ended') return
      await settleWar(c, war)
    })
  }
  return out
}

/**
 * Sinal de live por canal: o último `watch.tick`. Não existe `stream.offline` no
 * vocabulário de eventos (docs/EVENTOS.md) e esta fase não inventa tipo novo.
 */
async function lastLiveByChannel () {
  const { rows } = await query(
    `SELECT channel_id, max(created_at) AS last_at FROM guild_event
      WHERE type = 'watch.tick' AND created_at > now() - interval '1 day'
      GROUP BY channel_id`)
  return new Map(rows.map(r => [r.channel_id, r.last_at]))
}

/**
 * Territórios: fecho de disputa, liberações (R19, R20, R21) e o rendimento
 * diário do R23. Idempotente — pode rodar a cada 5 min sem creditar duas vezes.
 */
export async function runTerritoryCycle ({ now = new Date(), log = console } = {}) {
  const out = { disputes_closed: 0, released: 0, prestige_days: 0 }
  const step = async (key, id, fn) => {
    try { await tx(fn); out[key]++ } catch (err) {
      log.error?.({ err, id }, `territory: passo ${key} falhou`)
    }
  }

  // R25 — disputa vencida: maior WP acima de min_points leva; senão, `void`.
  const { rows: due } = await query(
    "SELECT * FROM territory_dispute WHERE status = 'open' AND closes_at <= $1", [now])
  for (const d of due) {
    await step('disputes_closed', d.id, async (c) => {
      const { rows: entries } = await c.query(
        `SELECT guild_id, points FROM territory_dispute_entry WHERE dispute_id = $1
          ORDER BY points DESC, joined_at`, [d.id])
      const top = entries[0]
      const tie = entries[1] && entries[1].points === top?.points
      const winner = top && top.points >= d.min_points && !tie ? top.guild_id : null
      await c.query(
        `UPDATE territory_dispute SET status = $2, winner_guild_id = $3, closed_at = now()
          WHERE id = $1`, [d.id, winner ? 'closed' : 'void', winner])
      if (winner) {
        await captureTerritory(c, {
          channelId: d.channel_id,
          territoryId: d.territory_id,
          guildId: winner,
          via: 'dispute',
          disputeId: d.id,
          releaseReason: 'lost_dispute',
        })
      }
      await c.query('DELETE FROM war_slot WHERE dispute_id = $1', [d.id])   // R24
      await emit(c, {
        channelId: d.channel_id,
        guildId: winner,
        type: 'dispute.closed',
        payload: { dispute_id: d.id, territory_id: d.territory_id, winner_guild_id: winner },
      })
    })
  }

  // R21 — guilda fora de active libera tudo na hora; o histórico permanece.
  const { rows: byStatus } = await query(
    `SELECT h.*, g.status FROM territory_holding h JOIN guild g ON g.id = h.guild_id
      WHERE h.released_at IS NULL AND NOT (g.status = ANY($1::guild_status[]))`, [ALIVE_STATUS])
  for (const h of byStatus) {
    await step('released', h.id, c => releaseHolding(c, h,
      h.status === 'banned' ? 'guild_banned' : 'guild_dissolved'))
  }

  // R20 — 14 dias sem nenhum guild_event da detentora.
  const { rows: stale } = await query(
    `SELECT h.* FROM territory_holding h
      WHERE h.released_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM guild_event e
                         WHERE e.guild_id = h.guild_id
                           AND e.created_at > now() - ($1::text || ' ms')::interval)`,
    [String(INACTIVITY_MS)])
  for (const h of stale) {
    await step('released', h.id, async (c) => {
      await releaseHolding(c, h, 'inactivity')
      await openAutoDispute(c, h)
    })
  }

  // R19 — ghosting territorial: 2 desafios de stake expirados em 7 dias.
  const { rows: ghosted } = await query(
    `SELECT h.*, count(w.id)::int AS ghosts FROM territory_holding h
       JOIN war w ON w.stake_territory_id = h.territory_id AND w.status = 'expired'
                 AND w.defender_guild_id = h.guild_id
                 AND w.challenge_expires_at > now() - interval '7 days'
                 AND w.challenge_expires_at > h.acquired_at
      WHERE h.released_at IS NULL
      GROUP BY h.id HAVING count(w.id) >= $1`, [TERRITORY_GHOST_LIMIT])
  for (const h of ghosted) {
    await step('released', h.id, async (c) => {
      await releaseHolding(c, h, 'ghosting')
      await openAutoDispute(c, h)
    })
  }

  out.prestige_days = await payTerritoryPrestige({ now, log })
  return out
}

/** R19/R20 — liberação automática abre disputa de 48 h sobre o território. */
async function openAutoDispute (client, holding) {
  const { rowCount } = await client.query(
    "SELECT 1 FROM territory_dispute WHERE territory_id = $1 AND status = 'open'",
    [holding.territory_id])
  if (rowCount) return null
  return openDispute(client, {
    channelId: holding.channel_id,
    territoryId: holding.territory_id,
    openedBy: 'system',
    opensAt: new Date(),
    closesAt: new Date(Date.now() + 2 * DAY_MS),
  })
}

/**
 * R23 — `prestige_per_day` do dia anterior, só se a detentora registrou ≥ 1
 * `guild_event` naquele dia. O crédito vai pelo ledger da fase 04 (a autoridade
 * de Prestígio é ela), com `external_id` por (território, dia): o `emit` do core
 * devolve null na segunda passada e o pagamento é uma vez só por dia.
 */
export async function payTerritoryPrestige ({ now = new Date(), log = console } = {}) {
  const day = utcDay(+now - DAY_MS)
  const { rows } = await query(
    `SELECT h.territory_id, h.guild_id, h.channel_id, t.prestige_per_day
       FROM territory_holding h
       JOIN territory t ON t.id = h.territory_id
      WHERE h.released_at IS NULL AND t.enabled AND t.prestige_per_day > 0
        AND h.acquired_at < ($1::date + 1)::timestamp AT TIME ZONE 'UTC'
        AND EXISTS (SELECT 1 FROM guild_event e
                     WHERE e.guild_id = h.guild_id
                       AND e.created_at >= ($1::date)::timestamp AT TIME ZONE 'UTC'
                       AND e.created_at <  ($1::date + 1)::timestamp AT TIME ZONE 'UTC')`,
    [day])

  let paid = 0
  for (const r of rows) {
    try {
      await tx(async (c) => {
        const ev = await emit(c, {
          channelId: r.channel_id,
          guildId: r.guild_id,
          type: 'territory.yield',
          payload: { amount: r.prestige_per_day, territory_id: r.territory_id, day },
          externalId: `territory:${r.territory_id}:${day}`,
        })
        if (ev) paid++
      })
    } catch (err) {
      log.error?.({ err, territory: r.territory_id }, 'territory: rendimento não creditado')
    }
  }
  return paid
}
