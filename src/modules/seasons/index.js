import { query, tx } from '../../core/db.js'
import { emit, audit } from '../../core/events.js'
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js'
import { requireModerator } from '../../core/auth.js'
import {
  ACTIVITY_TYPES, MAX_ADJUST, POINTS, PRESTIGE_TYPES, WEEKLY_OBJECTIVE,
  clampAdjust, prestigeFor, qualifiesForStreak, weekRange, weeklyObjectiveMet,
} from './prestige.js'
import {
  DEFAULT_LIMIT, MAX_LIMIT, RANK_ORDER_SQL,
  cursorExpired, decodeCursor, encodeCursor,
} from './ranking.js'
import { ACHIEVEMENTS, TRIGGER_TYPES, evaluateAll } from './achievements.js'
import { SEASON_DAYS, dueStatus, earlyEnd, nextWindow } from './lifecycle.js'
import { cached, redis } from '../../core/redis.js'

/**
 * Fase 04 — Competição. Como a fase 03, este módulo é sobretudo CONSUMIDOR de
 * `guild_event`: lança em `prestige_ledger` (imutável) e reconcilia
 * `guild_season_prestige` na mesma transação. Produz `season.started`,
 * `season.ended`, `achievement.unlocked` e `weekly.objective_completed`.
 *
 * A matemática está em prestige.js / ranking.js / achievements.js / lifecycle.js,
 * que são puros. Aqui só vive o que precisa de banco.
 */

const num = (v) => Number(v) || 0

/**
 * R13/R14 — o ranking é dos vivos. `overflow` entra: é guilda ativa acima do
 * limite de vagas (ARQUITETURA), não punição. O §5.4 escreveu só 'active' porque
 * `overflow` não existia quando o doc foi escrito; excluí-la sumiria com uma
 * guilda cheia do ranking. Banida/suspensa/dissolvida ficam de fora, com o
 * Prestígio preservado no ledger.
 */
const RANKED_STATUS = ['active', 'overflow']

function limitOf (q) {
  const n = Math.trunc(Number(q.limit ?? DEFAULT_LIMIT))
  if (n > MAX_LIMIT) throw badRequest('LIMIT_TOO_LARGE', `limit máximo é ${MAX_LIMIT}`)
  return Math.min(Math.max(n || DEFAULT_LIMIT, 1), MAX_LIMIT)
}

/** Criar/encerrar temporada e ajustar Prestígio são só do broadcaster (§9). */
function requireBroadcaster (req) {
  requireModerator(req)
  if (req.auth.role !== 'broadcaster') throw forbidden('FORBIDDEN', 'requer broadcaster')
  // audit_log.actor_user_id é NOT NULL: sem identidade concedida não há o que auditar.
  if (!req.auth.userId) throw forbidden('IDENTITY_REQUIRED', 'requer consentimento de identidade')
  return req.auth.userId
}

async function getGuild (client, channelId, gid) {
  const { rows } = await client.query(
    'SELECT * FROM guild WHERE id = $1 AND channel_id = $2', [num(gid), channelId])
  if (!rows[0]) throw notFound('GUILD_NOT_FOUND', 'guilda não encontrada')
  return rows[0]
}

async function getSeason (client, channelId, id) {
  const { rows } = await client.query(
    'SELECT * FROM season WHERE id = $1 AND channel_id = $2', [num(id), channelId])
  if (!rows[0]) throw notFound('SEASON_NOT_FOUND', 'temporada não encontrada')
  return rows[0]
}

/**
 * A temporada corrente é a que recebe pontos. Durante a hora de congelamento
 * existem duas vivas (R9) e a `active` é a nova — é nela que a atividade cai.
 */
async function currentSeason (client, channelId) {
  const { rows } = await client.query(
    `SELECT * FROM season WHERE channel_id = $1 AND status IN ('active','freezing')
      ORDER BY (status = 'active') DESC, starts_at DESC LIMIT 1`, [channelId])
  return rows[0] ?? null
}

// ------------------------------------------------------------------ prestígio

/**
 * Grava a linha do ledger e reconcilia o agregado na MESMA transação (R1, R2).
 * Devolve null quando o par (evento, fonte) já tinha lançamento — é a idempotência
 * de R4, tratada como no-op e não como erro.
 */
async function post (client, { channelId, guildId, seasonId, eventId, source, points, at }) {
  const { rows: [entry] } = await client.query(
    `INSERT INTO prestige_ledger (season_id, guild_id, channel_id, guild_event_id, source, points)
     VALUES ($1, $2, $3, $4, $5, $6::int)
     ON CONFLICT (guild_event_id, source) DO NOTHING RETURNING *`,
    [seasonId, guildId, channelId, eventId, source, points])
  if (!entry) return null

  // R16 — o piso é 0 (clamp, não erro). O ledger guarda o -5000 inteiro; o
  // agregado nunca fica negativo, e o recompute usa o mesmo greatest(0, ...).
  const { rows: [p] } = await client.query(
    `INSERT INTO guild_season_prestige (season_id, guild_id, channel_id, prestige, last_gain_at)
     VALUES ($1, $2, $3, greatest(0, $4::int), CASE WHEN $4::int > 0 THEN $5::timestamptz END)
     ON CONFLICT (season_id, guild_id) DO UPDATE
        SET prestige = greatest(0, guild_season_prestige.prestige + $4::int),
            last_gain_at = CASE WHEN $4::int > 0 THEN $5::timestamptz
                                ELSE guild_season_prestige.last_gain_at END,
            updated_at = now()
     RETURNING prestige, last_gain_at`,
    [seasonId, guildId, channelId, points, at ?? new Date()])

  await syncGuildPrestige(client, seasonId, guildId)
  updateLiveRank(seasonId, guildId, p.prestige, p.last_gain_at).catch(() => {})
  return entry
}

/**
 * Para o card "Sua Guilda" ser instantâneo, mantemos um ZSET no Redis com o
 * Prestígio de todas as guildas da temporada ativa.
 */
async function updateLiveRank (seasonId, guildId, prestige, lastGainAt) {
  const r = await redis()
  if (!r) return

  // Score do ZSET = prestige + (1 - (timestamp / 2^48)) para desempate ASC do tempo.
  // Como ZREVRANK quer score maior, (max - timestamp) funciona.
  const timestamp = lastGainAt ? +new Date(lastGainAt) : 0
  const score = Number(prestige) + (1 - (timestamp / 1_000_000_000_000_000))

  try {
    await r.zAdd(`rank:zset:${seasonId}`, { score, value: String(guildId) })
  } catch { /* silencioso */ }
}

/** `guild.prestige` (core) é espelho de leitura da temporada ativa — a fase 07 lê ele. */
const syncGuildPrestige = (client, seasonId, guildId) => client.query(
  `UPDATE guild g SET prestige = p.prestige
     FROM guild_season_prestige p, season s
    WHERE p.season_id = $1 AND p.guild_id = $2 AND g.id = p.guild_id
      AND s.id = p.season_id AND s.status = 'active'`, [seasonId, guildId])

/** Quantos membros da guilda já pontuaram neste mesmo evento do canal (R5). */
async function contributorsOf (client, ev) {
  const { rows: [r] } = await client.query(
    `SELECT count(*)::int AS n FROM prestige_ledger l
       JOIN guild_event e ON e.id = l.guild_event_id
      WHERE l.season_id = $1 AND l.guild_id = $2 AND l.source = 'event.participate'
        AND e.payload->>'event_id' = $3`,
    [ev.season_id, ev.guild_id, String(ev.payload?.event_id ?? '')])
  return r.n
}

/**
 * Um `guild_event` vira no máximo uma linha por fonte (R1). Fonte que vale 0 —
 * Bits, sub, gift (R3) ou o 21º participante (R5) — não gera linha nenhuma:
 * `prestige_ledger_zero_ck` proíbe ponto zero e a ausência já é a resposta.
 */
export async function applyPrestige (client, ev) {
  const payload = ev.payload ?? {}
  const contributors = ev.type === 'event.participate' ? await contributorsOf(client, ev) : 0
  const points = prestigeFor(ev.type, payload, { contributors })
  if (!points) return null

  const base = {
    channelId: ev.channel_id,
    guildId: ev.guild_id,
    seasonId: ev.season_id,
    eventId: ev.id,
    at: ev.created_at,
  }
  const entry = await post(client, { ...base, source: ev.type, points })
  if (entry && ev.type === 'event.win') await awardStreak(client, ev)
  return entry
}

/** §4.1 — +200 por vencer em 3 dias distintos numa janela de 7, 1× por janela. */
async function awardStreak (client, ev) {
  const { rows: wins } = await client.query(
    `SELECT e.created_at FROM prestige_ledger l JOIN guild_event e ON e.id = l.guild_event_id
      WHERE l.season_id = $1 AND l.guild_id = $2 AND l.source = 'event.win'
        AND e.created_at > $3::timestamptz - interval '7 days' AND e.created_at <= $3`,
    [ev.season_id, ev.guild_id, ev.created_at])
  if (!qualifiesForStreak(wins.map(w => w.created_at), ev.created_at)) return null

  // A janela conta pelo instante do EVENTO, não pelo do lançamento: um backfill
  // que processa uma semana de uma vez não pode distribuir 5 bônus no mesmo minuto.
  const { rowCount } = await client.query(
    `SELECT 1 FROM prestige_ledger l JOIN guild_event e ON e.id = l.guild_event_id
      WHERE l.season_id = $1 AND l.guild_id = $2 AND l.source = 'streak'
        AND e.created_at > $3::timestamptz - interval '7 days'`,
    [ev.season_id, ev.guild_id, ev.created_at])
  if (rowCount) return null

  return post(client, {
    channelId: ev.channel_id,
    guildId: ev.guild_id,
    seasonId: ev.season_id,
    eventId: ev.id,
    source: 'streak',
    points: POINTS.streak,
    at: ev.created_at,
  })
}

/** R2 — reconstrói o agregado a partir do ledger. É o que `recompute` chama. */
export async function recomputeSeason (client, seasonId) {
  const { rows } = await client.query(
    `INSERT INTO guild_season_prestige (season_id, guild_id, channel_id, prestige, last_gain_at)
     -- last_gain_at vem do evento, igual ao caminho incremental: se viesse do
     -- created_at do ledger, um recompute reordenaria os empates do ranking.
     SELECT l.season_id, l.guild_id, l.channel_id,
            greatest(0, sum(l.points))::int,
            max(e.created_at) FILTER (WHERE l.points > 0)
       FROM prestige_ledger l JOIN guild_event e ON e.id = l.guild_event_id
      WHERE l.season_id = $1
      GROUP BY l.season_id, l.guild_id, l.channel_id
     ON CONFLICT (season_id, guild_id) DO UPDATE
        SET prestige = EXCLUDED.prestige, last_gain_at = EXCLUDED.last_gain_at, updated_at = now()
     RETURNING guild_id`, [seasonId])
  for (const r of rows) await syncGuildPrestige(client, seasonId, r.guild_id)
  return rows.length
}

// -------------------------------------------------------------------- ranking

/**
 * Materializa o retrato do ranking. O ORDER BY é `RANK_ORDER_SQL`, a mesma regra
 * do comparador puro — ordem total, então duas guildas nunca dividem `position` (R11).
 */
export async function takeSnapshot (client, seasonId, isFinal = false) {
  if (isFinal) {
    // R12: apuração idempotente. O índice parcial já garante um final só.
    const { rows: [ex] } = await client.query(
      'SELECT id FROM ranking_snapshot WHERE season_id = $1 AND is_final', [seasonId])
    if (ex) return ex.id
  }
  const { rows: [snap] } = await client.query(
    'INSERT INTO ranking_snapshot (season_id, is_final) VALUES ($1, $2) RETURNING id',
    [seasonId, isFinal])
  await client.query(
    `INSERT INTO ranking_snapshot_row (snapshot_id, position, guild_id, prestige)
     SELECT $2::bigint, (row_number() OVER (ORDER BY ${RANK_ORDER_SQL}))::int, g.id, p.prestige
       FROM guild_season_prestige p JOIN guild g ON g.id = p.guild_id
      WHERE p.season_id = $1 AND g.status = ANY($3::guild_status[])`,
    [seasonId, snap.id, RANKED_STATUS])
  return snap.id
}

/** Posição ao vivo (§5.1). ponytail: janela sobre a temporada inteira — D7 troca por ZSET. */
async function livePosition (client, seasonId, guildId) {
  const r = await redis()
  if (r) {
    try {
      const rank = await r.zRevRank(`rank:zset:${seasonId}`, String(guildId))
      if (rank !== null) {
        const prestigeScore = await r.zScore(`rank:zset:${seasonId}`, String(guildId))
        return {
          guild_id: guildId,
          prestige: Math.floor(prestigeScore),
          position: rank + 1,
        }
      }
    } catch { /* fallback */ }
  }

  const { rows } = await client.query(
    `WITH ranked AS (
       SELECT p.guild_id, p.prestige,
              row_number() OVER (ORDER BY ${RANK_ORDER_SQL}) AS position
         FROM guild_season_prestige p JOIN guild g ON g.id = p.guild_id
        WHERE p.season_id = $1 AND g.status = ANY($2::guild_status[]))
     SELECT * FROM ranked WHERE guild_id = $3`, [seasonId, RANKED_STATUS, guildId])
  return rows[0] ?? null
}

// ---------------------------------------------------------------- conquistas

async function grant (client, { channelId, guildId, code, seasonId, sourceEventId }) {
  const { rows: [row] } = await client.query(
    `INSERT INTO guild_achievement (channel_id, guild_id, achievement_code, season_id, source_event_id)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING *`,
    [channelId, guildId, code, seasonId, sourceEventId])
  if (!row) return null                                     // R17/R18: já concedida

  // R21 — a fase 07 anuncia epic/legendary sem consultar tabela nova.
  await emit(client, {
    channelId,
    guildId,
    type: 'achievement.unlocked',
    payload: { achievement_id: code, code, rarity: ACHIEVEMENTS[code].rarity, season_id: seasonId },
  })
  return row
}

/** R19 — a vitória mais antiga da temporada; empate exato resolve pelo menor id. */
async function firstBloodGuild (client, channelId, season) {
  const { rows: [row] } = await client.query(
    `SELECT e.guild_id FROM guild_event e JOIN guild g ON g.id = e.guild_id
      WHERE e.channel_id = $1 AND e.type = 'event.win'
        AND e.created_at >= $2 AND e.created_at < $3
        AND g.status <> 'banned'
      ORDER BY e.created_at, e.id LIMIT 1`,
    [channelId, season.starts_at, season.ends_at])
  return row?.guild_id ?? null
}

/**
 * Recalcula todas as conquistas de uma guilda a partir do estado atual e concede
 * o que faltar. Idempotente por construção — é por isso que o handler incremental
 * e o backfill retroativo são a mesma função.
 */
export async function evaluateGuild (client, channelId, guildId, sourceEventId = null) {
  const { rows: [g] } = await client.query(
    `SELECT g.id, g.channel_id, g.level, g.status,
            (SELECT count(*) FROM guild_member m WHERE m.guild_id = g.id)::int AS members,
            (SELECT count(*) FROM guild_event e
              WHERE e.guild_id = g.id AND e.type = 'event.win')::int AS wins,
            (SELECT count(*) FROM season_award a WHERE a.guild_id = g.id)::int AS podiums
       FROM guild g WHERE g.id = $1 AND g.channel_id = $2`, [guildId, channelId])
  if (!g || g.status === 'banned') return []                // R20

  const season = await currentSeason(client, channelId)
  const stats = {
    ...g,
    first_win_of_season: season
      ? await firstBloodGuild(client, channelId, season) === g.id
      : false,
  }

  const granted = []
  for (const a of evaluateAll(stats)) {
    const seasonId = a.scope === 'seasonal' ? season?.id ?? null : null
    if (a.scope === 'seasonal' && !seasonId) continue
    if (!a.unlocked) {
      await client.query(
        `INSERT INTO guild_achievement_progress (guild_id, achievement_code, channel_id, current)
         VALUES ($1, $2, $3, greatest(0, $4::int))
         ON CONFLICT (guild_id, achievement_code)
           DO UPDATE SET current = EXCLUDED.current, updated_at = now()`,
        [guildId, a.code, channelId, a.current])
      continue
    }
    const row = await grant(client, { channelId, guildId, code: a.code, seasonId, sourceEventId })
    if (row) granted.push(a.code)
  }
  return granted
}

// --------------------------------------------------------------------- rotas

export default async function seasons (app) {
  app.get('/seasons/current', async (req) => {
    const season = await currentSeason({ query }, req.auth.channelId)
    if (!season) throw notFound('NO_ACTIVE_SEASON', 'nenhuma temporada em andamento')
    const { rows: [c] } = await query(
      'SELECT count(*)::int AS n FROM guild_season_prestige WHERE season_id = $1', [season.id])
    return {
      id: season.id,
      number: season.number,
      name: season.name,
      status: season.status,
      starts_at: season.starts_at,
      ends_at: season.ends_at,
      guild_count: c.n,
    }
  })

  app.get('/seasons', async (req) => {
    const limit = limitOf(req.query)
    const cursor = req.query.cursor ? Number(req.query.cursor) : null
    if (req.query.cursor && !Number.isFinite(cursor)) {
      throw badRequest('INVALID_CURSOR', 'cursor inválido')
    }
    const { rows } = await query(
      `SELECT id, number, name, status, starts_at, ends_at FROM season
        WHERE channel_id = $1 AND ($2::bigint IS NULL OR id < $2)
        ORDER BY id DESC LIMIT $3`, [req.auth.channelId, cursor, limit])
    return { items: rows, next_cursor: rows.length === limit ? String(rows.at(-1).id) : null }
  })

  /**
   * §5.1 — a lista pública é uma janela de 60 s. O `snapshot_id` viaja no cursor
   * para que a página 3 venha do mesmo retrato da página 1.
   */
  app.get('/ranking', async (req) => {
    const cid = req.auth.channelId
    const limit = limitOf(req.query)
    let snapshot
    let after = 0

    if (req.query.cursor) {
      const cur = decodeCursor(req.query.cursor)
      if (!cur) throw badRequest('INVALID_CURSOR', 'cursor inválido')
      after = cur.position
      const { rows } = await query(
        `SELECT r.* FROM ranking_snapshot r JOIN season s ON s.id = r.season_id
          WHERE r.id = $1 AND s.channel_id = $2`, [cur.snapshot_id, cid])
      if (!rows[0]) throw badRequest('INVALID_CURSOR', 'cursor inválido')
      if (cursorExpired(rows[0])) {
        throw conflict('CURSOR_EXPIRED', 'snapshot expirado, recomece da primeira página')
      }
      snapshot = rows[0]
    } else {
      const season = req.query.season_id
        ? await getSeason({ query }, cid, req.query.season_id)
        : await currentSeason({ query }, cid)
      if (!season) throw notFound('SEASON_NOT_FOUND', 'nenhuma temporada')
      const { rows } = await query(
        `SELECT * FROM ranking_snapshot WHERE season_id = $1
          ORDER BY is_final DESC, taken_at DESC LIMIT 1`, [season.id])
      // Antes do primeiro tick do job não existe retrato: tira um agora.
      snapshot = rows[0] ?? await tx(async (c) => {
        const id = await takeSnapshot(c, season.id)
        const { rows: [s] } = await c.query('SELECT * FROM ranking_snapshot WHERE id = $1', [id])
        return s
      })
    }

    // Um snapshot é imutável, então a página cacheada nunca fica velha — o TTL
    // só existe para limitar memória. Sem Redis, cai direto no Postgres.
    const rows = await cached(`rank:${snapshot.id}:${after}:${limit}`, 300, async () => {
      const { rows } = await query(
        `WITH current_snap AS (
           SELECT position, guild_id, prestige
             FROM ranking_snapshot_row
            WHERE snapshot_id = $1
         ),
         prev_snap_id AS (
           SELECT id FROM ranking_snapshot
            WHERE season_id = $4 AND id < $1
            ORDER BY taken_at DESC LIMIT 1
         ),
         prev_snap AS (
           SELECT position, guild_id
             FROM ranking_snapshot_row
            WHERE snapshot_id = (SELECT id FROM prev_snap_id)
         )
         SELECT r.position, r.guild_id, r.prestige, g.name, g.tag, g.level, g.emblem_preset,
                (p.position - r.position) AS delta_position
           FROM current_snap r
           JOIN guild g ON g.id = r.guild_id
           LEFT JOIN prev_snap p ON p.guild_id = r.guild_id
          WHERE r.position > $2
          ORDER BY r.position LIMIT $3`, [snapshot.id, after, limit, snapshot.season_id])
      return rows
    })

    return {
      snapshot_id: snapshot.id,
      season_id: snapshot.season_id,
      taken_at: snapshot.taken_at,
      is_final: snapshot.is_final,
      items: rows,
      next_cursor: rows.length === limit
        ? encodeCursor({ snapshot_id: snapshot.id, position: rows.at(-1).position })
        : null,
    }
  })

  /** Card "sua guilda": ao vivo, não sai do snapshot (§5.1). */
  app.get('/guilds/:gid/rank', async (req) => {
    const cid = req.auth.channelId
    const guild = await getGuild({ query }, cid, req.params.gid)
    const season = req.query.season_id
      ? await getSeason({ query }, cid, req.query.season_id)
      : await currentSeason({ query }, cid)
    if (!season) throw notFound('SEASON_NOT_FOUND', 'nenhuma temporada')

    const live = await livePosition({ query }, season.id, guild.id)

    // Se a guilda ainda não tem Prestígio (comum em guildas novas),
    // devolvemos posição nula em vez de 404 para não quebrar o console do devtools.
    if (!live) {
      return {
        season_id: season.id,
        position: null,
        prestige: 0,
        delta_position: null,
        live: true,
      }
    }

    const { rows: [prev] } = await query(
      `SELECT r.position FROM ranking_snapshot_row r
         JOIN ranking_snapshot s ON s.id = r.snapshot_id
        WHERE s.season_id = $1 AND r.guild_id = $2
        ORDER BY s.taken_at DESC LIMIT 1`, [season.id, guild.id])

    return {
      season_id: season.id,
      position: num(live.position),
      prestige: live.prestige,
      delta_position: prev ? prev.position - num(live.position) : null,   // + = subiu
      live: true,
    }
  })

  app.get('/guilds/:gid/prestige/ledger', async (req) => {
    const cid = req.auth.channelId
    const guild = await getGuild({ query }, cid, req.params.gid)
    await requireMembership(req, guild)
    const limit = limitOf(req.query)
    const cursor = req.query.cursor ? Number(req.query.cursor) : null
    if (req.query.cursor && !Number.isFinite(cursor)) {
      throw badRequest('INVALID_CURSOR', 'cursor inválido')
    }
    const season = req.query.season_id
      ? await getSeason({ query }, cid, req.query.season_id)
      : await currentSeason({ query }, cid)
    if (!season) throw notFound('SEASON_NOT_FOUND', 'nenhuma temporada')

    const { rows } = await query(
      `SELECT id, source, points, created_at FROM prestige_ledger
        WHERE season_id = $1 AND guild_id = $2 AND ($3::bigint IS NULL OR id < $3)
        ORDER BY id DESC LIMIT $4`, [season.id, guild.id, cursor, limit])
    return {
      items: rows.map(r => ({ source: r.source, points: r.points, created_at: r.created_at })),
      next_cursor: rows.length === limit ? String(rows.at(-1).id) : null,
    }
  })

  app.get('/seasons/:sid/podium', async (req) => {
    const season = await getSeason({ query }, req.auth.channelId, req.params.sid)
    if (!['closed', 'archived'].includes(season.status)) {
      throw conflict('SEASON_NOT_CLOSED', 'pódio só existe depois da apuração')
    }
    const { rows } = await query(
      `SELECT a.position, a.guild_id, a.prestige_final, g.name, g.tag
         FROM season_award a JOIN guild g ON g.id = a.guild_id
        WHERE a.season_id = $1 ORDER BY a.position`, [season.id])
    return { season, awards: rows }
  })

  app.get('/guilds/:gid/achievements', async (req) => {
    const guild = await getGuild({ query }, req.auth.channelId, req.params.gid)
    const { rows: unlocked } = await query(
      `SELECT ga.achievement_code AS code, a.name, a.rarity, a.scope,
              s.number AS season_number, ga.unlocked_at
         FROM guild_achievement ga
         JOIN achievement a ON a.code = ga.achievement_code
         LEFT JOIN season s ON s.id = ga.season_id
        WHERE ga.guild_id = $1 ORDER BY ga.unlocked_at`, [guild.id])
    const has = new Set(unlocked.map(u => u.code))
    const { rows: progress } = await query(
      'SELECT achievement_code AS code, current FROM guild_achievement_progress WHERE guild_id = $1',
      [guild.id])
    return {
      unlocked,
      progress: progress
        .filter(p => !has.has(p.code) && ACHIEVEMENTS[p.code])
        .map(p => ({
          code: p.code,
          name: ACHIEVEMENTS[p.code].name,
          description: ACHIEVEMENTS[p.code].description,
          current: p.current,
          target: ACHIEVEMENTS[p.code].target
        })),
    }
  })

  // ------------------------------------------------------------ moderação

  app.post('/mod/seasons', async (req, reply) => tx(async (c) => {
    requireBroadcaster(req)
    const cid = req.auth.channelId
    const name = String(req.body?.name ?? '').trim()
    if (!name) throw badRequest('SEASON_NAME_REQUIRED', 'name obrigatório')

    const starts = new Date(req.body?.starts_at ?? Date.now())
    const ends = new Date(req.body?.ends_at ?? +starts + SEASON_DAYS * 86_400_000)
    if (Number.isNaN(+starts) || Number.isNaN(+ends) || +ends <= +starts + 7 * 86_400_000) {
      throw badRequest('INVALID_WINDOW', 'janela precisa ser maior que 7 dias')
    }

    const { rows: [last] } = await c.query(
      'SELECT coalesce(max(number), 0) AS n FROM season WHERE channel_id = $1', [cid])
    const now = Date.now()
    const status = +starts <= now && now < +ends ? 'active' : 'scheduled'

    const { rows: [season] } = await c.query(
      `INSERT INTO season (channel_id, number, name, status, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [cid, num(last.n) + 1, name, status, starts, ends]).catch(overlap)

    if (status === 'active') await announceStart(c, season)
    await audit(c, {
      channelId: cid,
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      action: 'season.create',
      target: `season:${season.id}`,
      after: { name, starts_at: starts, ends_at: ends, status },
    })
    reply.code(201)
    return { id: season.id, number: season.number, status: season.status }
  }))

  app.patch('/mod/seasons/:sid', async (req) => tx(async (c) => {
    requireBroadcaster(req)
    const season = await getSeason(c, req.auth.channelId, req.params.sid)
    if (['closed', 'archived'].includes(season.status)) {
      throw conflict('SEASON_CLOSED', 'temporada encerrada não muda')
    }
    const name = req.body?.name === undefined ? season.name : String(req.body.name).trim()
    if (!name) throw badRequest('SEASON_NAME_REQUIRED', 'name obrigatório')
    const ends = req.body?.ends_at === undefined ? new Date(season.ends_at) : new Date(req.body.ends_at)
    if (Number.isNaN(+ends) || +ends <= +new Date(season.starts_at) + 7 * 86_400_000) {
      throw badRequest('INVALID_WINDOW', 'janela precisa ser maior que 7 dias')
    }
    const { rows: [updated] } = await c.query(
      'UPDATE season SET name = $2, ends_at = $3 WHERE id = $1 RETURNING *',
      [season.id, name, ends]).catch(overlap)
    await audit(c, {
      channelId: req.auth.channelId,
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      action: 'season.update',
      target: `season:${season.id}`,
      before: { name: season.name, ends_at: season.ends_at },
      after: { name, ends_at: ends },
    })
    return { season: updated }
  }))

  /** Encerramento manual: entra na hora de congelamento como o automático (§6.2). */
  app.post('/mod/seasons/:sid/close', async (req, reply) => tx(async (c) => {
    requireBroadcaster(req)
    const season = await getSeason(c, req.auth.channelId, req.params.sid)
    if (season.status !== 'active') throw conflict('SEASON_NOT_ACTIVE', 'temporada não está ativa')

    const ends = earlyEnd(season)
    await c.query("UPDATE season SET status = 'freezing', ends_at = $2 WHERE id = $1",
      [season.id, ends])
    await ensureSuccessor(c, { ...season, ends_at: ends })
    await audit(c, {
      channelId: req.auth.channelId,
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      action: 'season.close',
      target: `season:${season.id}`,
      after: { reason: String(req.body?.reason ?? ''), ends_at: ends },
    })
    reply.code(202)
    return { status: 'freezing', ends_at: ends }
  }))

  /**
   * R16 — o ajuste não fura "servidor é a autoridade": grava `prestige.manual_adjust`
   * e passa pelo mesmo handler; o valor vem do broadcaster autenticado e cai no audit_log.
   */
  app.post('/mod/guilds/:gid/prestige-adjust', async (req) => tx(async (c) => {
    requireBroadcaster(req)
    const cid = req.auth.channelId
    const points = Math.trunc(Number(req.body?.points))
    const reason = String(req.body?.reason ?? '').trim()
    if (!Number.isFinite(points) || points === 0 || Math.abs(points) > MAX_ADJUST) {
      throw badRequest('ADJUST_OUT_OF_RANGE', `points inteiro, não nulo, |points| ≤ ${MAX_ADJUST}`)
    }
    if (!reason) throw badRequest('REASON_REQUIRED', 'reason obrigatório')

    const guild = await getGuild(c, cid, req.params.gid)
    const season = await currentSeason(c, cid)
    if (!season || season.status !== 'active') {
      throw notFound('NO_ACTIVE_SEASON', 'nenhuma temporada ativa')
    }

    const ev = await emit(c, {
      channelId: cid,
      guildId: guild.id,
      type: 'prestige.manual_adjust',
      payload: { amount: clampAdjust(points), actor_user_id: req.auth.userId, reason },
      actorUserId: req.auth.userId,
    })
    await applyPrestige(c, {
      ...ev, channel_id: cid, guild_id: guild.id, season_id: season.id,
      type: 'prestige.manual_adjust', payload: { amount: points },
    })

    const { rows: [p] } = await c.query(
      'SELECT prestige FROM guild_season_prestige WHERE season_id = $1 AND guild_id = $2',
      [season.id, guild.id])
    await audit(c, {
      channelId: cid,
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      action: 'prestige.adjust',
      target: `guild:${guild.id}`,
      after: { points, reason, prestige: p?.prestige ?? 0 },
    })
    return { prestige: p?.prestige ?? 0 }
  }))

  app.post('/mod/seasons/:sid/recompute', async (req, reply) => tx(async (c) => {
    requireBroadcaster(req)
    const season = await getSeason(c, req.auth.channelId, req.params.sid)
    if (season.status === 'archived') throw conflict('SEASON_ARCHIVED', 'temporada arquivada')
    const guilds = await recomputeSeason(c, season.id)
    reply.code(202)
    // ponytail: síncrono. Vira job de fila quando uma temporada passar de ~10⁵ linhas.
    return { job_id: `recompute:${season.id}`, guilds }
  }))
}

/** Mod vê qualquer guilda; viewer só a dele (o ledger é detalhe interno). */
async function requireMembership (req, guild) {
  try { requireModerator(req); return } catch { /* segue para a checagem de membro */ }
  const { rowCount } = await query(
    'SELECT 1 FROM guild_member WHERE guild_id = $1 AND user_id = $2',
    [guild.id, req.auth.userId ?? ''])
  if (!rowCount) throw forbidden('FORBIDDEN', 'só membros veem o ledger da guilda')
}

/** R8 — sobreposição de janela e segunda `active` são a mesma resposta. */
function overlap (err) {
  if (err.code === '23P01' || err.constraint === 'season_one_active') {
    throw conflict('SEASON_OVERLAP', 'janela sobrepõe outra temporada do canal')
  }
  throw err
}

const announceStart = (client, season) => emit(client, {
  channelId: season.channel_id,
  type: 'season.started',
  payload: { season_id: season.id, name: season.name, ends_at: season.ends_at },
})

// ----------------------------------------------------------------------- jobs
// Registrar em src/core/jobs.js (ver relatório). Todos `needs: 'nothing'`.

/**
 * Passada do handler de Prestígio: todo `guild_event` pontuável que ainda não tem
 * linha no ledger. O JOIN com `season` já implementa R7 — evento fora da janela de
 * uma temporada `active` simplesmente não é selecionado.
 *
 * ponytail: varredura por NOT EXISTS com janela de 7 dias, igual à fase 03. Vira
 * cursor persistido por canal quando a tabela passar dos milhões.
 */
export async function ingestPrestigeOnce ({ limit = 200, lookbackDays = 7, log = console } = {}) {
  const { rows } = await query(
    `SELECT e.id, e.channel_id, e.guild_id, e.type, e.payload, e.created_at, s.id AS season_id
       FROM guild_event e
       JOIN season s ON s.channel_id = e.channel_id AND s.status = 'active'
                    AND e.created_at >= s.starts_at AND e.created_at < s.ends_at
      WHERE e.type = ANY($1) AND e.guild_id IS NOT NULL
        AND e.created_at > now() - ($2::text || ' days')::interval
        AND NOT EXISTS (
          SELECT 1 FROM prestige_ledger l WHERE l.guild_event_id = e.id AND l.source = e.type)
      ORDER BY e.created_at, e.id LIMIT $3`,
    [PRESTIGE_TYPES, String(lookbackDays), limit])

  let posted = 0
  let points = 0
  let failed = 0
  for (const ev of rows) {
    try {
      const entry = await tx(c => applyPrestige(c, ev))
      if (entry) { posted++; points += entry.points }
    } catch (err) {
      failed++
      log.error?.({ err, event: ev.id }, 'prestige: evento não processado')
    }
  }
  return { scanned: rows.length, posted, points, failed }
}

/** §5.1 — retrato a cada 60 s enquanto a temporada está ativa. */
export async function snapshotRankings ({ log = console } = {}) {
  const { rows } = await query("SELECT id FROM season WHERE status = 'active'")
  let taken = 0
  for (const s of rows) {
    try { await tx(c => takeSnapshot(c, s.id)); taken++ } catch (err) {
      log.error?.({ err, season: s.id }, 'ranking: snapshot falhou')
    }
  }
  // §5.3 — o não-final velho não serve a ninguém; o is_final fica para sempre.
  await query("DELETE FROM ranking_snapshot WHERE NOT is_final AND taken_at < now() - interval '24 hours'")
  return { seasons: taken }
}

/**
 * Ciclo de vida (§6.2). A ordem importa: `freezing` primeiro, porque
 * `season_one_active` só libera a seguinte depois que a atual sai de `active`.
 */
export async function runSeasonLifecycle ({ now = new Date(), log = console } = {}) {
  const { rows } = await query(
    `SELECT * FROM season WHERE status IN ('scheduled','active','freezing','closed')
      ORDER BY channel_id, starts_at`)
  const out = { freezing: 0, started: 0, closed: 0, archived: 0 }
  // A linha em memória acompanha a transição para que uma passada só leve a
  // temporada de `active` até `closed` — senão a apuração esperaria o tick seguinte.
  const due = (status) => rows.filter(s => dueStatus(s, now) === status && s.status !== status)

  for (const s of due('freezing')) {
    await run(() => tx(async (c) => {
      await c.query("UPDATE season SET status = 'freezing' WHERE id = $1 AND status = 'active'", [s.id])
      await ensureSuccessor(c, s)
      s.status = 'freezing'
    }), out, 'freezing', s, log)
  }
  for (const s of due('active')) {
    await run(() => tx(async (c) => {
      const { rowCount } = await c.query(
        "UPDATE season SET status = 'active' WHERE id = $1 AND status = 'scheduled'", [s.id])
      if (rowCount) await announceStart(c, s)
      s.status = 'active'
    }), out, 'started', s, log)
  }
  for (const s of due('closed')) {
    await run(() => tx(async (c) => {
      await settle(c, s)
      Object.assign(s, { status: 'closed', closed_at: new Date() })
    }), out, 'closed', s, log)
  }
  for (const s of due('archived')) {
    await run(() => query("UPDATE season SET status = 'archived' WHERE id = $1", [s.id]),
      out, 'archived', s, log)
  }
  return out
}

async function run (fn, out, key, season, log) {
  try { await fn(); out[key]++ } catch (err) {
    log.error?.({ err, season: season.id }, `season: transição ${key} falhou`)
  }
}

/**
 * R9 — a temporada seguinte já está `active` durante a apuração, então atividade
 * do viewer nunca é descartada. Se o broadcaster não agendou nada, o ciclo se
 * mantém sozinho com uma janela de 90 dias.
 */
async function ensureSuccessor (client, prev) {
  const { rowCount } = await client.query(
    `SELECT 1 FROM season WHERE channel_id = $1 AND status IN ('scheduled','active')
       AND ends_at > now()`, [prev.channel_id])
  if (rowCount) return null

  const next = nextWindow(prev)
  // A fronteira sai do próprio banco, nunca de um Date do JS: timestamptz tem
  // precisão de microssegundo e Date só de milissegundo, então round-trip fazia
  // a sucessora começar até 999µs antes da anterior terminar — e o EXCLUDE
  // `tstzrange [)` de season_no_overlap rejeitava a virada, em silêncio.
  const { rows: [season] } = await client.query(
    `INSERT INTO season (channel_id, number, name, status, starts_at, ends_at)
     SELECT channel_id, $2, $3, 'active', ends_at, ends_at + ($4 || ' days')::interval
       FROM season WHERE id = $1
     RETURNING *`,
    [prev.id, next.number, next.name, SEASON_DAYS])
  await announceStart(client, season)
  return season
}

/** Apuração: snapshot final, pódio, `season.ended` e limpeza do sazonal (§6.2, §6.3). */
async function settle (client, season) {
  const snapshotId = await takeSnapshot(client, season.id, true)

  // R15 — banida/dissolvida não recebe prêmio; as posições abaixo sobem.
  const { rows: podium } = await client.query(
    `SELECT r.guild_id, r.prestige FROM ranking_snapshot_row r JOIN guild g ON g.id = r.guild_id
      WHERE r.snapshot_id = $1 AND g.status = ANY($2::guild_status[])
      ORDER BY r.position LIMIT 3`, [snapshotId, RANKED_STATUS])

  for (const [i, row] of podium.entries()) {
    await client.query(
      `INSERT INTO season_award (season_id, position, guild_id, prestige_final)
       VALUES ($1, $2, $3, $4) ON CONFLICT (season_id, position) DO NOTHING`,
      [season.id, i + 1, row.guild_id, row.prestige])                    // R12
  }
  await client.query(
    "UPDATE season SET status = 'closed', closed_at = now() WHERE id = $1 AND status = 'freezing'",
    [season.id])

  await emit(client, {
    channelId: season.channel_id,
    type: 'season.ended',
    payload: {
      season_id: season.id,
      podium: podium.map((r, i) => ({
        position: i + 1, guild_id: r.guild_id, prestige_final: r.prestige,
      })),
    },
  })

  // §6.3 — progresso sazonal zera na virada; o desbloqueado fica.
  await client.query(
    `DELETE FROM guild_achievement_progress p USING achievement a
      WHERE a.code = p.achievement_code AND a.scope = 'seasonal' AND p.channel_id = $1`,
    [season.channel_id])

  // Imortais pode fechar a 3ª aparição agora que o pódio existe.
  for (const r of podium) await evaluateGuild(client, season.channel_id, r.guild_id)
  return podium
}

/**
 * D1 — objetivo semanal automático. É a fonte de Prestígio que não depende da
 * fase 05: sem ela o ranking de canal pequeno nasce parado. O evento é emitido
 * com `external_id = guilda:semana`, então o `emit` do core devolve null na
 * segunda passada da mesma semana e o teto de 1 por semana ISO é do banco.
 */
export async function runWeeklyObjectives ({ now = new Date(), log = console } = {}) {
  const { key, start, end } = weekRange(now)
  const { rows } = await query(
    `SELECT gm.guild_id, g.channel_id,
            count(DISTINCT e.actor_user_id)::int AS members,
            count(DISTINCT (e.created_at AT TIME ZONE 'UTC')::date)::int AS days
       FROM guild_event e
       JOIN guild_member gm ON gm.channel_id = e.channel_id AND gm.user_id = e.actor_user_id
       JOIN guild g ON g.id = gm.guild_id AND g.status = ANY($1::guild_status[])
       JOIN season s ON s.channel_id = g.channel_id AND s.status = 'active'
      WHERE e.type = ANY($2) AND e.actor_user_id IS NOT NULL
        AND e.created_at >= $3 AND e.created_at < $4
        AND e.created_at >= s.starts_at AND e.created_at < s.ends_at
      GROUP BY gm.guild_id, g.channel_id`,
    [RANKED_STATUS, ACTIVITY_TYPES, start, end])

  let completed = 0
  for (const r of rows) {
    if (!weeklyObjectiveMet(r)) continue
    try {
      const ev = await tx(c => emit(c, {
        channelId: r.channel_id,
        guildId: r.guild_id,
        type: 'weekly.objective_completed',
        payload: { objective: WEEKLY_OBJECTIVE.code, week: key },
        externalId: `${r.guild_id}:${key}`,
      }))
      if (ev) completed++
    } catch (err) {
      log.error?.({ err, guild: r.guild_id }, 'weekly: objetivo não registrado')
    }
  }
  return { week: key, scanned: rows.length, completed }
}

/** Handler de conquistas: reavalia as guildas tocadas por evento-gatilho recente. */
export async function ingestAchievementsOnce ({ lookbackMinutes = 30, limit = 500, log = console } = {}) {
  const { rows } = await query(
    `SELECT e.channel_id, e.guild_id, max(e.id) AS event_id
       FROM guild_event e
      WHERE e.type = ANY($1) AND e.guild_id IS NOT NULL
        AND e.created_at > now() - ($2::text || ' minutes')::interval
      GROUP BY e.channel_id, e.guild_id LIMIT $3`,
    [TRIGGER_TYPES, String(lookbackMinutes), limit])

  let granted = 0
  for (const r of rows) {
    try {
      granted += (await tx(c => evaluateGuild(c, r.channel_id, r.guild_id, r.event_id))).length
    } catch (err) {
      log.error?.({ err, guild: r.guild_id }, 'achievements: guilda não avaliada')
    }
  }
  return { scanned: rows.length, granted }
}

/**
 * §7 — retroatividade das 4 permanentes. Roda uma vez, à mão:
 *   node -e "import('./src/modules/seasons/index.js').then(m=>m.backfillAchievements())"
 * É a mesma função do handler, então rodar de novo não cria linha (R18).
 */
export async function backfillAchievements ({ log = console } = {}) {
  const { rows } = await query(
    "SELECT id, channel_id FROM guild WHERE status <> 'banned'")
  let granted = 0
  for (const g of rows) {
    try {
      granted += (await tx(c => evaluateGuild(c, g.channel_id, g.id))).length
    } catch (err) {
      log.error?.({ err, guild: g.id }, 'backfill: guilda não avaliada')
    }
  }
  return { guilds: rows.length, granted }
}
