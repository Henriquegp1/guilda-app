import { query, tx } from '../../core/db.js'
import { emit, audit } from '../../core/events.js'
import { badRequest, forbidden, notFound } from '../../core/errors.js'
import { requireModerator } from '../../core/auth.js'
import {
  MAX_LEVEL, levelForXp, memberLimitForLevel, unlocksBetween, unlocksUpTo,
  xpForLevel, xpToNext,
} from './curve.js'
import { DAILY_CAP, REVERSAL, RULES, earn, publicTable } from './rules.js'

/**
 * Fase 03 — Progressão. Este módulo é quase todo CONSUMIDOR: lê `guild_event`,
 * lança em `guild_xp_entry` e recalcula os agregados da guilda. Produz um único
 * tipo de evento, `guild.level_up` (R16).
 *
 * A matemática está em curve.js e a tabela de ganho em rules.js — os dois são
 * puros e é onde os testes moram. Aqui só vive o que precisa de banco.
 */

const num = (v) => Number(v) || 0
const utcDay = (d = new Date()) => new Date(d).toISOString().slice(0, 10)
const REVERSAL_SOURCE = 'channel.subscription.end'
const XP_TYPES = [...Object.keys(RULES), REVERSAL_SOURCE]
const REVERSAL_WINDOW = "interval '72 hours'"   // §4.4: depois disso é fim de assinatura normal

// ---------------------------------------------------------------- leitura base

async function getGuild (client, channelId, gid) {
  const { rows } = await client.query(
    'SELECT * FROM guild WHERE id = $1 AND channel_id = $2', [num(gid), channelId])
  if (!rows[0]) throw notFound('GUILD_NOT_FOUND', 'guilda não encontrada')
  return rows[0]
}

function requireUser (auth) {
  if (!auth.userId) throw forbidden('IDENTITY_REQUIRED', 'requer consentimento de identidade')
  return auth.userId
}

/**
 * Consumo do dia do membro. O teto global vem de member_xp_daily; os limites de
 * cada fonte são derivados do próprio ledger — uma fonte de verdade só (§7).
 *
 * O UPSERT existe pelo lado do lock: ele trava a linha do par (canal, usuário) e
 * serializa dois eventos concorrentes do mesmo membro no mesmo dia.
 */
async function usageOf (client, channelId, userId, day, type) {
  const { rows: [d] } = await client.query(
    `INSERT INTO member_xp_daily (channel_id, user_id, day) VALUES ($1, $2, $3)
     ON CONFLICT (channel_id, user_id, day)
       DO UPDATE SET xp_granted = member_xp_daily.xp_granted
     RETURNING xp_granted, watch_ticks`, [channelId, userId, day])

  const { rows } = await client.query(
    `SELECT reason, coalesce(sum(amount), 0)::int AS xp,
            count(*) FILTER (WHERE amount > 0)::int AS count
       FROM guild_xp_entry
      WHERE channel_id = $1 AND user_id = $2
        AND created_at >= ($3::date)::timestamp AT TIME ZONE 'UTC'
        AND created_at <  ($3::date + 1)::timestamp AT TIME ZONE 'UTC'
      GROUP BY reason`, [channelId, userId, day])
  const bySource = Object.fromEntries(rows.map(r => [r.reason, { xp: r.xp, count: r.count }]))

  // Follow é bônus vitalício por usuário/canal: o dia não responde.
  if (RULES[type]?.lifetime) {
    const { rows: [ever] } = await client.query(
      `SELECT count(*) FILTER (WHERE amount > 0)::int AS count,
              coalesce(sum(amount), 0)::int AS xp
         FROM guild_xp_entry
        WHERE channel_id = $1 AND user_id = $2 AND reason = $3`, [channelId, userId, type])
    bySource[type] = ever
  }
  return { xpToday: d.xp_granted, ticksToday: d.watch_ticks, bySource }
}

/**
 * A quem o evento credita e se credita (R4, R7, R8, R14).
 * `eligible: false` não descarta nada: o lançamento entra com amount 0 e o evento
 * continua auditável.
 */
async function attribution (client, channelId, userId) {
  if (!userId) return { guildId: null, eligible: false, eligibleAt: null }

  const { rows: [m] } = await client.query(
    `SELECT gm.guild_id, gm.joined_at, g.status,
            EXISTS (SELECT 1 FROM guild_membership_history h
                     WHERE h.channel_id = gm.channel_id AND h.user_id = gm.user_id
                       AND h.guild_id <> gm.guild_id
                       AND h.left_at > gm.joined_at - interval '7 days') AS hopped
       FROM guild_member gm JOIN guild g ON g.id = gm.guild_id
      WHERE gm.channel_id = $1 AND gm.user_id = $2`, [channelId, userId])

  if (!m) return { guildId: null, eligible: false, eligibleAt: null }          // R4: sem guilda

  // R8: quem trocou de guilda nos últimos 7 dias só rende para a nova após 24 h.
  const eligibleAt = m.hopped ? new Date(+new Date(m.joined_at) + 86_400_000) : null
  const base = { guildId: m.guild_id, eligibleAt }

  if (!['active', 'overflow'].includes(m.status)) return { ...base, eligible: false }   // R14
  if (eligibleAt && eligibleAt > new Date()) return { ...base, eligible: false }

  const { rowCount } = await client.query(                                     // R7
    'SELECT 1 FROM xp_quarantine WHERE channel_id = $1 AND user_id = $2 AND until > now()',
    [channelId, userId])
  return { ...base, eligible: !rowCount }
}

// ---------------------------------------------------------------- lançamento

/**
 * Grava o lançamento e reconcilia os agregados na MESMA transação (R1, R9).
 * Devolve null quando o evento já tinha lançamento — `UNIQUE (event_id)` é a
 * idempotência do reprocessamento, e o `emit` do core já cobre o webhook repetido.
 */
async function post (client, {
  channelId, guildId = null, userId = null, eventId, amount, reason,
  capped = false, reverses = null, day = utcDay(),
}) {
  const { rows: [entry] } = await client.query(
    `INSERT INTO guild_xp_entry
       (channel_id, guild_id, user_id, event_id, amount, reason, capped, reverses_entry_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING *`,
    [channelId, guildId, userId, eventId, amount, reason, capped, reverses])
  if (!entry) return null
  if (!amount) return entry

  if (userId && amount > 0) {
    // Estorno não devolve orçamento do dia: o teto é budget anti-abuso, não saldo.
    await client.query(
      `UPDATE member_xp_daily
          SET xp_granted  = least(${DAILY_CAP}, xp_granted + $4),
              watch_ticks = least(18, watch_ticks + $5)
        WHERE channel_id = $1 AND user_id = $2 AND day = $3`,
      [channelId, userId, day, amount, reason === 'watch.tick' ? 1 : 0])
  }

  if (guildId) {
    if (userId) {
      await client.query(
        // Casts explícitos: sem eles o mesmo $4 seria deduzido int4 no INSERT e
        // int8 no UPDATE, e o Postgres recusa o statement.
        `INSERT INTO guild_member_xp (guild_id, user_id, channel_id, xp_total)
         VALUES ($1, $2, $3, greatest(0, $4::bigint))
         ON CONFLICT (guild_id, user_id)
           DO UPDATE SET xp_total = greatest(0, guild_member_xp.xp_total + $4::bigint),
                         updated_at = now()`,
        [guildId, userId, channelId, amount])
    }
    // greatest(0, ...): a CHECK proíbe XP negativo. Um estorno maior que o saldo
    // deixa guild.xp e o ledger divergentes de propósito — reconcileXp acusa.
    const { rows: [guild] } = await client.query(
      'UPDATE guild SET xp = greatest(0, xp + $2::bigint) WHERE id = $1 RETURNING *',
      [guildId, amount])
    await recomputeLevel(client, guild)
  }
  return entry
}

/**
 * R9/R10/R11/R16 — nível, vagas e overflow derivados do XP. `guild` é a linha
 * DEPOIS do UPDATE de xp e ANTES do recálculo: level/member_limit ainda são os antigos.
 */
export async function recomputeLevel (client, guild) {
  const level = levelForXp(guild.xp)
  const limit = memberLimitForLevel(level)
  // R10: limite abaixo da lotação não expulsa ninguém — a guilda só para de admitir.
  const status = ['active', 'overflow'].includes(guild.status)
    ? (guild.member_count > limit ? 'overflow' : 'active')
    : guild.status

  if (level === guild.level && limit === guild.member_limit && status === guild.status) return level

  await client.query(
    'UPDATE guild SET level = $2, member_limit = $3, status = $4::guild_status WHERE id = $1',
    [guild.id, level, limit, status])

  if (level > guild.level) {
    const unlocks = unlocksBetween(guild.level, level)
    for (const key of unlocks) {
      await client.query(
        `INSERT INTO guild_unlock (guild_id, unlock_key, level_earned) VALUES ($1, $2, $3)
         ON CONFLICT (guild_id, unlock_key) DO NOTHING`,   // R11: append-only
        [guild.id, key, level])
    }
    // R16: só a subida vira evento público. Queda é silenciosa.
    await emit(client, {
      channelId: guild.channel_id,
      guildId: guild.id,
      type: 'guild.level_up',
      payload: { from: guild.level, to: level, unlocks },
    })
  }
  return level
}

/** Um `guild_event` vira exatamente um lançamento (R1). */
export async function applyEvent (client, ev) {
  const userId = ev.actor_user_id ?? ev.payload?.user_id ?? null
  const day = utcDay(ev.created_at)

  if (ev.type === REVERSAL_SOURCE) return applyReversal(client, ev, userId, day)

  const { guildId, eligible } = await attribution(client, ev.channel_id, userId)
  const base = { channelId: ev.channel_id, guildId, userId, eventId: ev.id, day }

  // Sem usuário identificado ou sem direito a XP: lançamento zerado, evento auditável.
  if (!userId || !eligible) {
    return post(client, { ...base, amount: 0, reason: ev.type, capped: false })
  }

  const usage = await usageOf(client, ev.channel_id, userId, day, ev.type)
  const { amount, capped } = earn(ev.type, ev.payload ?? {}, usage)
  return post(client, { ...base, amount, reason: ev.type, capped })
}

/**
 * R12/§4.4 — estorno é lançamento negativo, nunca UPDATE nem DELETE. O evento que
 * o dispara é o `channel.subscription.end` da Twitch; fora da janela de 72 h é fim
 * de assinatura normal e o lançamento fica em 0 só para não reprocessar o evento.
 */
async function applyReversal (client, ev, userId, day) {
  const base = { channelId: ev.channel_id, userId, eventId: ev.id, reason: REVERSAL, day }
  if (!userId) return post(client, { ...base, amount: 0 })

  const { rows: [orig] } = await client.query(
    `SELECT e.* FROM guild_xp_entry e
      WHERE e.channel_id = $1 AND e.user_id = $2 AND e.reason = 'channel.subscribe'
        AND e.amount > 0 AND e.created_at > $3::timestamptz - ${REVERSAL_WINDOW}
        AND NOT EXISTS (SELECT 1 FROM guild_xp_entry r WHERE r.reverses_entry_id = e.id)
      ORDER BY e.created_at DESC LIMIT 1`,
    [ev.channel_id, userId, ev.created_at])
  if (!orig) return post(client, { ...base, amount: 0 })

  // O débito volta para a guilda que recebeu o crédito, mesmo que o membro já tenha saído.
  return post(client, { ...base, guildId: orig.guild_id, amount: -orig.amount, reverses: orig.id })
}

// ---------------------------------------------------------------- rotas

export default async function xp (app) {
  // Progressão da guilda: o painel exibe, nunca calcula (§Autoridade de valores).
  app.get('/guilds/:gid/progression', async (req) => {
    const guild = await getGuild({ query }, req.auth.channelId, req.params.gid)
    const { rows } = await query(
      'SELECT unlock_key FROM guild_unlock WHERE guild_id = $1', [guild.id])
    // União: o nível atual manda, e o que já foi ganho não some numa queda (R11).
    const unlocks = [...new Set([...unlocksUpTo(guild.level), ...rows.map(r => r.unlock_key)])]

    return {
      level: guild.level,
      xp: num(guild.xp),
      xp_next_level: guild.level >= MAX_LEVEL ? null : xpForLevel(guild.level + 1),
      xp_to_next: xpToNext(guild.xp),
      member_limit: guild.member_limit,
      member_count: guild.member_count,
      status: guild.status,
      unlocks,
    }
  })

  app.get('/guilds/:gid/xp/contributions', async (req) => {
    const cid = req.auth.channelId
    const guild = await getGuild({ query }, cid, req.params.gid)
    await requireMembership(req, guild)

    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 50)
    const [cx, cu] = String(req.query.cursor ?? '').split(':')
    const { rows } = await query(
      `WITH ranked AS (
         SELECT user_id, xp_total,
                row_number() OVER (ORDER BY xp_total DESC, user_id) AS rank
           FROM guild_member_xp WHERE guild_id = $1)
       SELECT * FROM ranked
        WHERE $2::bigint IS NULL OR xp_total < $2 OR (xp_total = $2 AND user_id > $3)
        ORDER BY xp_total DESC, user_id LIMIT $4`,
      [guild.id, cx === '' || cx === undefined ? null : cx, cu ?? '', limit])

    return {
      // display_name não existe no EBS: a extensão resolve o nome pelo user_id.
      items: rows.map(r => ({ user_id: r.user_id, xp_total: num(r.xp_total), rank: num(r.rank) })),
      next_cursor: rows.length === limit ? `${rows.at(-1).xp_total}:${rows.at(-1).user_id}` : null,
    }
  })

  // Aba de histórico: desbloqueio de Nv.12 (§6, R11).
  app.get('/guilds/:gid/xp/history', async (req) => {
    const guild = await getGuild({ query }, req.auth.channelId, req.params.gid)
    if (!(await hasUnlock(guild, 'xp_history'))) {
      throw forbidden('UNLOCK_NOT_AVAILABLE', 'histórico de XP desbloqueia no Nv.12')
    }
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90)
    const { rows } = await query(
      `SELECT day, xp_total, level FROM guild_level_snapshot
        WHERE guild_id = $1 AND day > current_date - $2::int
        ORDER BY day`, [guild.id, days])
    return { days: rows.map(r => ({ day: utcDay(r.day), xp: num(r.xp_total), level: r.level })) }
  })

  app.get('/me/xp/daily', async (req) => {
    const cid = req.auth.channelId
    const userId = requireUser(req.auth)
    const { rows: [d] } = await query(
      'SELECT xp_granted, watch_ticks FROM member_xp_daily WHERE channel_id = $1 AND user_id = $2 AND day = $3',
      [cid, userId, utcDay()])
    const { eligibleAt } = await attribution({ query }, cid, userId)
    const usado = d?.xp_granted ?? 0
    return {
      xp_today: usado,
      xp_remaining: DAILY_CAP - usado,
      cap: DAILY_CAP,
      ticks_today: d?.watch_ticks ?? 0,
      eligible_at: eligibleAt,
    }
  })

  // Tabela de ganho. O canal vem do auth: caminho não é fonte de tenancy.
  app.get('/xp/table', async () => publicTable())

  // R13 — ajuste de moderação. Auditado, limitado e sempre pelo ledger.
  app.post('/mod/guilds/:gid/xp/adjust', async (req) => tx(async (c) => {
    requireModerator(req)
    const cid = req.auth.channelId
    const actorId = requireUser(req.auth)
    const amount = Math.trunc(Number(req.body?.amount))
    const reason = String(req.body?.reason ?? '').trim()

    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 5000) {
      throw badRequest('INVALID_ADJUSTMENT', 'amount inteiro, não nulo, |amount| ≤ 5000')
    }
    if (!reason) throw badRequest('INVALID_ADJUSTMENT', 'reason obrigatório')

    const guild = await getGuild(c, cid, req.params.gid)
    // Não existe tipo de evento de ajuste de XP em docs/EVENTOS.md, e inventar um
    // é mudança de core: `guild.moderated` é o tipo registrado para "moderação agiu".
    const ev = await emit(c, {
      channelId: cid,
      guildId: guild.id,
      type: 'guild.moderated',
      payload: { action: 'xp_adjust', actor_user_id: actorId, amount, reason },
      actorUserId: actorId,
    })
    await post(c, {
      channelId: cid,
      guildId: guild.id,
      eventId: ev.id,
      amount,
      reason: 'guild.moderated',
    })

    const { rows: [depois] } = await c.query('SELECT xp, level FROM guild WHERE id = $1', [guild.id])
    await audit(c, {
      channelId: cid,
      actorUserId: actorId,
      actorRole: req.auth.role,
      action: 'xp.adjust',
      target: `guild:${guild.id}`,
      before: { xp: num(guild.xp), level: guild.level },
      after: { xp: num(depois.xp), level: depois.level, amount, reason },
    })
    return { xp: num(depois.xp), level: depois.level }
  }))

  /**
   * Bot do streamer registrando participação/vitória de evento. É o único produtor
   * de XP que esta fase entrega: watch tick e EventSub precisam de Helix e de rota
   * fora de /api/v1 (ver relatório).
   */
  app.post('/mod/events/grant', async (req, reply) => tx(async (c) => {
    requireModerator(req)
    const cid = req.auth.channelId
    const type = String(req.body?.type ?? '')
    const externalId = String(req.body?.external_id ?? '')
    const userIds = [...new Set((req.body?.user_ids ?? []).map(String).filter(Boolean))]

    if (!['event.participate', 'event.win'].includes(type)) {
      throw badRequest('INVALID_TYPE', 'type deve ser event.participate ou event.win')
    }
    if (!externalId) throw badRequest('INVALID_TYPE', 'external_id obrigatório')
    if (!userIds.length) throw badRequest('INVALID_TYPE', 'user_ids vazio')

    let granted = 0
    let skipped = 0
    for (const userId of userIds) {
      const { guildId } = await attribution(c, cid, userId)
      const ev = await emit(c, {
        channelId: cid,
        guildId,
        type,
        payload: { event_id: externalId, user_id: userId },
        actorUserId: userId,
        externalId: `${externalId}:${userId}`,   // R3: reenvio do bot não credita 2×
      })
      if (!ev) { skipped++; continue }
      await applyEvent(c, { ...ev, channel_id: cid, guild_id: guildId, type, payload: { event_id: externalId, user_id: userId }, actor_user_id: userId })
      granted++
    }
    reply.code(202)
    return { granted, skipped }
  }))
}

async function requireMembership (req, guild) {
  try { requireModerator(req); return } catch { /* mod vê tudo; membro só a sua */ }
  const { rowCount } = await query(
    'SELECT 1 FROM guild_member WHERE guild_id = $1 AND user_id = $2',
    [guild.id, req.auth.userId ?? ''])
  if (!rowCount) throw forbidden('NOT_IN_GUILD', 'só membros veem a contribuição')
}

/** R11 — vale o nível atual OU o que já foi ganho e não é retirado. */
async function hasUnlock (guild, key) {
  if (unlocksUpTo(guild.level).includes(key)) return true
  const { rowCount } = await query(
    'SELECT 1 FROM guild_unlock WHERE guild_id = $1 AND unlock_key = $2', [guild.id, key])
  return rowCount > 0
}

// ---------------------------------------------------------------- jobs
// Registrar em src/core/jobs.js (ver relatório).

/**
 * Passada do handler: todo `guild_event` que vale XP e ainda não tem lançamento.
 *
 * ponytail: janela de 7 dias e varredura por NOT EXISTS, sem cursor. Serve até a
 * casa dos milhões de eventos; depois, cursor persistido por canal. Um evento que
 * sempre falha é reprocessado toda passada — por isso o erro é logado e contado.
 */
export async function ingestXpOnce ({ limit = 200, lookbackDays = 7, log = console } = {}) {
  const { rows } = await query(
    `SELECT e.id, e.channel_id, e.guild_id, e.type, e.payload, e.actor_user_id, e.created_at
       FROM guild_event e
      WHERE e.type = ANY($1) AND e.created_at > now() - ($2::text || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM guild_xp_entry x WHERE x.event_id = e.id)
      ORDER BY e.created_at, e.id LIMIT $3`,
    [XP_TYPES, String(lookbackDays), limit])

  let posted = 0
  let xpTotal = 0
  let failed = 0
  for (const ev of rows) {
    try {
      const entry = await tx(c => applyEvent(c, ev))
      if (entry) { posted++; xpTotal += entry.amount }
    } catch (err) {
      failed++
      log.error?.({ err, event: ev.id }, 'xp: evento não processado')
    }
  }
  return { scanned: rows.length, posted, xp: xpTotal, failed }
}

/**
 * R17 — snapshot diário imutável. Roda 00:10 UTC: a primeira gravação do dia é o
 * estado com que o dia começou, e o ON CONFLICT garante que nada a reescreve.
 */
export async function snapshotDaily (day = utcDay()) {
  const { rows } = await query(
    `INSERT INTO guild_level_snapshot
       (channel_id, guild_id, day, xp_total, level, member_count, member_limit)
     SELECT channel_id, id, $1::date, xp, level, member_count, member_limit
       FROM guild WHERE status IN ('active', 'overflow', 'suspended')
     ON CONFLICT (guild_id, day) DO NOTHING
     RETURNING guild_id`, [day])
  return { day, guilds: rows.length }
}

/**
 * R17 — `guild.xp` é cache derivado do ledger. Aqui só o alerta: corrigir sozinho
 * mexeria em nível e vagas sem ninguém olhando, e o caso normal é bug, não drift.
 */
export async function reconcileXp ({ log = console } = {}) {
  const { rows } = await query(
    `SELECT g.id AS guild_id, g.channel_id, g.xp::bigint AS cached,
            coalesce(sum(x.amount), 0)::bigint AS ledger
       FROM guild g LEFT JOIN guild_xp_entry x ON x.guild_id = g.id
      GROUP BY g.id
     HAVING g.xp <> coalesce(sum(x.amount), 0)`)
  for (const d of rows) log.warn?.({ ...d }, 'xp: guild.xp diverge do ledger')
  return rows.map(r => ({ ...r, cached: num(r.cached), ledger: num(r.ledger) }))
}
