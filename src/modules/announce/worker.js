import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { query, tx } from '../../core/db.js'
import { CATALOG, DEFAULT_TEMPLATES_AGG, passesCatalogFilter } from './catalog.js'
import { decide, inQuietHours, AGG_WINDOW_MS, AGG_TRIGGER, AGG_MAX, TTL_MS } from './ratelimit.js'
import { listOf, renderMessage } from './template.js'
import { decryptSecret, signatureHeader } from './sign.js'

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** ULID de 26 chars: 10 de tempo + 16 aleatórios. Não vale uma dependência. */
export function ulid (now = Date.now()) {
  let t = ''
  for (let n = now, i = 0; i < 10; i++, n = Math.floor(n / 32)) t = CROCKFORD[n % 32] + t
  const r = randomBytes(16)
  let s = ''
  for (const b of r) s += CROCKFORD[b % 32]
  return t + s
}

// --- SSRF (§11) -----------------------------------------------------------
const PRIVATE_V4 = [
  [10, 0, 0, 0, 8], [127, 0, 0, 0, 8], [169, 254, 0, 0, 16], [172, 16, 0, 0, 12],
  [192, 168, 0, 0, 16], [0, 0, 0, 0, 8], [100, 64, 0, 0, 10], [192, 0, 0, 0, 24],
]
const toInt = (a) => a.reduce((x, o) => (x << 8 >>> 0) + o, 0) >>> 0

export function isPrivateAddress (address, family) {
  if (family === 6) {
    const a = address.toLowerCase()
    return a === '::1' || a === '::' || a.startsWith('fc') || a.startsWith('fd') ||
      a.startsWith('fe80') || a.startsWith('::ffff:')   // v4-mapeado: não sabemos o alvo real
  }
  const o = address.split('.').map(Number)
  const ip = toInt(o)
  return PRIVATE_V4.some(([a, b, c, d, bits]) => (ip >>> (32 - bits)) === (toInt([a, b, c, d]) >>> (32 - bits)))
}

/** Revalidada na gravação E no dispatch — DNS muda entre as duas. */
export async function assertPublicUrl (raw) {
  let u
  try { u = new URL(raw) } catch { throw new Error('url inválida') }
  if (u.protocol !== 'https:') throw new Error('só https')
  const addrs = await lookup(u.hostname, { all: true })
  if (!addrs.length) throw new Error('dns sem resposta')
  for (const a of addrs) {
    if (isPrivateAddress(a.address, a.family)) throw new Error(`destino privado: ${a.address}`)
  }
}

// --- estado do canal ------------------------------------------------------
export const getConfig = async (channelId) =>
  (await query('SELECT * FROM announce_config WHERE channel_id = $1', [channelId])).rows[0] ?? null

const quietOf = (cfg) => cfg.quiet_from ? { from: cfg.quiet_from, to: cfg.quiet_to, timezone: cfg.timezone } : null

/** Segredos vivos: o `active` e, durante a rotação, o `retiring` não vencido. */
export async function liveSecrets (channelId, now = Date.now()) {
  const { rows } = await query(
    `SELECT secret_enc, status, retires_at FROM announce_secret
      WHERE channel_id = $1 AND status <> 'revoked' ORDER BY created_at DESC`, [channelId])
  return rows
    .filter(r => r.status === 'active' || (r.retires_at && +new Date(r.retires_at) > now))
    .map(r => decryptSecret(r.secret_enc))
}

/** R3/R4: só guilda pública anuncia. Reavaliada no dispatch, não só na entrada. */
export const guildEligible = (status) => status == null || status === 'active' || status === 'overflow'

// --- variáveis de template ------------------------------------------------
const PT = {
  'guild.level_up': (p) => ({ nivel: p.to, nivel_anterior: p.from, desbloqueio: (p.unlocks ?? []).join(', ') }),
  'war.declared': (p) => ({ oponente: p.opponent_name, tag_oponente: p.opponent_tag, duracao: p.format }),
  'war.accepted': (p) => ({ oponente: p.opponent_name, tag_oponente: p.opponent_tag, duracao: p.format }),
  'war.ended': (p) => ({ oponente: p.opponent_name, tag_oponente: p.opponent_tag, vencedor: p.winner_name, placar: p.score }),
  'territory.captured': (p) => ({ territorio: p.territory_name ?? p.territory_id, dono_anterior: p.previous_guild_name }),
  'achievement.unlocked': (p) => ({ conquista: p.achievement_name ?? p.achievement_id, raridade: p.rarity }),
  'season.started': (p) => ({ temporada: p.name ?? p.season_id, termina_em: p.ends_at }),
  'season.ended': (p) => ({ temporada: p.name ?? p.season_id, primeiro: p.podium?.[0], segundo: p.podium?.[1], terceiro: p.podium?.[2] }),
  'guild.recruiting': (p) => ({ vagas: p.vagas, modo: p.modo }),
}

/**
 * R20: nada de user_id, opaque_user_id, e-mail ou Bits. `{lider}` só existe se a
 * fase produtora colocar o display name no payload — o core não tem tabela de
 * nomes de exibição.
 */
export function varsFromEvent (row) {
  const p = row.payload ?? {}
  const extra = PT[row.type]?.(p) ?? {}
  const vars = {
    guilda: row.guild_name ?? p.guilda ?? p.name ?? null,
    tag: row.guild_tag ?? p.tag ?? null,
    lider: p.lider ?? p.leader_name ?? null,
    nivel: row.guild_level, prestigio: row.guild_prestige,
    membros: row.member_count, canal: row.channel_name,
    ...extra,
  }
  // O produtor pode mandar a variável em pt-BR direto e ela ganha.
  for (const k of CATALOG[row.type].vars) if (p[k] != null) vars[k] = p[k]
  return vars
}

const EVENT_SELECT = `
  SELECT ge.id, ge.type, ge.guild_id, ge.payload, ge.created_at,
         g.name AS guild_name, g.tag AS guild_tag, g.status AS guild_status,
         g.level AS guild_level, g.prestige AS guild_prestige,
         c.twitch_channel_id AS channel_name,
         (SELECT count(*) FROM guild_member m WHERE m.guild_id = g.id) AS member_count`

// --- ingestão: guild_event -> announce_outbox -----------------------------
/**
 * Lê os `guild_event` ainda não avaliados e decide o destino de cada um.
 * Só as regras que dependem do estado de entrada (R2/R3/R10/R11 + cooldown +
 * agregação); teto, rajada e espaçamento ficam para o dispatch (R8/R9).
 */
export async function ingestOnce (channelId, { now = Date.now(), limit = 200 } = {}) {
  const cfg = await getConfig(channelId)
  if (!cfg?.enabled || !cfg.webhook_url) return { enqueued: 0, suppressed: 0 }   // R1

  const types = Object.keys(CATALOG)
  const { rows: evCfg } = await query(
    'SELECT event_type, enabled, template, template_agg, cooldown_s FROM announce_event_config WHERE channel_id = $1',
    [channelId])
  const byType = new Map(evCfg.map(r => [r.event_type, r]))
  // R10: tipo desligado não é enfileirado nem suprimido — simplesmente não existe.
  const active = types.filter(t => byType.get(t)?.enabled)
  if (!active.length) return { enqueued: 0, suppressed: 0 }

  const { rows: events } = await query(`${EVENT_SELECT}
    FROM guild_event ge
    LEFT JOIN guild g ON g.id = ge.guild_id
    JOIN channel c ON c.id = ge.channel_id
    WHERE ge.channel_id = $1 AND ge.type = ANY($2)
      AND ge.created_at >= $3
      AND NOT EXISTS (SELECT 1 FROM announce_outbox o
                       WHERE o.channel_id = ge.channel_id AND o.dedup_key = ge.id::text)
    ORDER BY ge.created_at LIMIT $4`,
  [channelId, active, cfg.enabled_at ?? new Date(0), limit])   // R2

  // Estado por tipo, atualizado em memória ao longo do lote.
  const lastType = new Map()
  const aggWindow = new Map()
  for (const t of active) {
    const { rows } = await query(
      `SELECT max(coalesce(sent_at, created_at)) AS last,
              max(agg_window) FILTER (WHERE status = 'queued' AND agg_window IS NOT NULL) AS win
         FROM announce_outbox
        WHERE channel_id = $1 AND event_type = $2
          AND status IN ('sent','sending','queued')`, [channelId, t])
    lastType.set(t, rows[0].last ? +new Date(rows[0].last) : null)
    aggWindow.set(t, rows[0].win ? +new Date(rows[0].win) : null)
  }

  let enqueued = 0
  let suppressed = 0
  for (const ev of events) {
    const cat = CATALOG[ev.type]
    const ec = byType.get(ev.type)
    if (!passesCatalogFilter(ev.type, ev.payload)) continue          // §3: conquista comum é ruído
    // R3/R4: pending, rejeitada, suspended ou banned nunca anuncia.
    if (!guildEligible(ev.guild_status)) {
      await insertOutbox({ ev, cfg, cat, status: 'suppressed', reason: 'guild_ineligible', now })
      suppressed++
      continue
    }

    const d = decide({
      priority: cat.priority, onCooldown: cat.onCooldown, cooldownS: ec.cooldown_s,
      lastTypeAt: lastType.get(ev.type), aggWindowStart: aggWindow.get(ev.type),
      mutedUntil: cfg.muted_until ? +new Date(cfg.muted_until) : null,
      quiet: quietOf(cfg), offline: cfg.offline,
    }, now)

    if (d.acao === 'suprimir') {
      await insertOutbox({ ev, cfg, cat, status: 'suppressed', reason: d.motivo, now })
      suppressed++
      continue
    }

    const aggStart = d.acao === 'agregar' ? d.notBefore - AGG_WINDOW_MS : null
    const { message } = renderMessage({ eventType: ev.type, template: ec.template, vars: varsFromEvent(ev) })
    const ok = await insertOutbox({
      ev, cfg, cat, status: 'queued', now,
      message: d.acao === 'agregar' ? null : message,
      notBefore: d.notBefore, aggWindow: aggStart,
    })
    if (!ok) continue                                                 // R5: replay não duplica
    enqueued++

    if (d.acao === 'agregar') aggWindow.set(ev.type, aggStart)
    else lastType.set(ev.type, now)
    if (d.motivo === 'supersede') {                                   // R16
      await query(
        `UPDATE announce_outbox SET status = 'superseded'
          WHERE channel_id = $1 AND event_type = $2 AND status = 'queued' AND id <> $3`,
        [channelId, ev.type, ok])
    }
  }
  return { enqueued, suppressed }
}

async function insertOutbox ({ ev, cfg, cat, status, reason = null, message = null, notBefore, aggWindow = null, now }) {
  const id = ulid(now)
  const nb = new Date(notBefore ?? now)
  const payload = {
    id,
    channel_id: String(ev.channel_name ?? cfg.channel_id),
    event: ev.type,
    priority: cat.priority,
    occurred_at: new Date(ev.created_at).toISOString(),
    message,
    aggregate: { count: 1, window_s: 0 },
    vars: varsFromEvent(ev),
  }
  const { rows } = await query(
    `INSERT INTO announce_outbox
       (id, channel_id, guild_event_id, guild_id, event_type, priority, dedup_key,
        status, suppress_reason, message, payload, not_before, expires_at, agg_window, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (channel_id, dedup_key) DO NOTHING RETURNING id`,
    [id, cfg.channel_id, ev.id, ev.guild_id, ev.type, cat.priority, String(ev.id),
      status, reason, message, payload, nb, new Date(+nb + TTL_MS), aggWindow && new Date(aggWindow), new Date(now)])
  return rows[0]?.id ?? null
}

// --- agregação ------------------------------------------------------------
/** Fecha janelas vencidas ou cheias. ≥3 vira um agregado; 1 ou 2 saem sozinhos (R15). */
export async function flushAggregates (channelId, now = Date.now()) {
  const { rows: groups } = await query(
    `SELECT event_type, agg_window, count(*)::int AS n
       FROM announce_outbox
      WHERE channel_id = $1 AND status = 'queued' AND agg_window IS NOT NULL
      GROUP BY 1, 2
     HAVING count(*) >= $2 OR agg_window <= $3`,
    [channelId, AGG_MAX, new Date(now - AGG_WINDOW_MS)])

  let made = 0
  for (const g of groups) {
    await tx(async (c) => {
      const { rows: members } = await c.query(
        `SELECT id, payload, guild_id FROM announce_outbox
          WHERE channel_id = $1 AND event_type = $2 AND agg_window = $3 AND status = 'queued'
          ORDER BY created_at FOR UPDATE`,
        [channelId, g.event_type, g.agg_window])
      if (!members.length) return

      if (members.length < AGG_TRIGGER) {
        await c.query(
          `UPDATE announce_outbox SET agg_window = NULL, not_before = $2 WHERE id = ANY($1)`,
          [members.map(m => m.id), new Date(now)])
        return
      }

      const { rows: [ec] } = await c.query(
        'SELECT template_agg FROM announce_event_config WHERE channel_id = $1 AND event_type = $2',
        [channelId, g.event_type])
      const nomes = members.map(m => m.payload.vars?.guilda).filter(Boolean)
      const vars = { ...members[members.length - 1].payload.vars, quantidade: members.length, lista: listOf(nomes) }
      const template = ec?.template_agg ?? DEFAULT_TEMPLATES_AGG[g.event_type]
      const { message } = renderMessage({ eventType: g.event_type, template, vars, agg: true })

      const id = ulid(now)
      const payload = {
        id,
        channel_id: members[0].payload.channel_id,
        event: g.event_type,
        priority: CATALOG[g.event_type].priority,
        occurred_at: new Date(now).toISOString(),
        message,
        aggregate: { count: members.length, window_s: AGG_WINDOW_MS / 1000 },
        vars,
      }
      await c.query(
        `INSERT INTO announce_outbox
           (id, channel_id, event_type, priority, dedup_key, status, aggregate_count,
            message, payload, not_before, expires_at)
         VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$8,$9,$10)
         ON CONFLICT (channel_id, dedup_key) DO NOTHING`,
        [id, channelId, g.event_type, CATALOG[g.event_type].priority,
          `agg:${g.event_type}:${Math.floor(+new Date(g.agg_window) / 1000)}`,
          members.length, message, payload, new Date(now), new Date(now + TTL_MS)])
      // R14: os membros viram parte do agregado e nunca saem sozinhos.
      await c.query(
        `UPDATE announce_outbox SET status = 'aggregated', agg_window = NULL WHERE id = ANY($1)`,
        [members.map(m => m.id)])
      made++
    })
  }
  return made
}

// --- entrega --------------------------------------------------------------
const RETRIABLE = (s) => s === 408 || s === 429 || s >= 500
const BACKOFF_MS = [2000, 10000]                     // §4: 2 s → 10 s
const jitter = (ms) => Math.round(ms * (0.8 + Math.random() * 0.4))   // ±20 %

async function sendOnce (item, cfg, secrets, attempt, fetchImpl, now) {
  const body = JSON.stringify(item.payload)
  const ts = Math.floor(now / 1000)
  const t0 = Date.now()
  try {
    const res = await fetchImpl(cfg.webhook_url, {
      method: 'POST',
      redirect: 'manual',                            // §11: sem seguir redirect
      signal: AbortSignal.timeout(5000),             // §4: 5 s total
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-guilds-delivery-id': item.id,             // R7: estável entre tentativas
        'x-guilds-event': item.event_type,
        'x-guilds-timestamp': String(ts),
        'x-guilds-attempt': String(attempt),
        'x-guilds-signature': signatureHeader(secrets, ts, body),
      },
      body,
    })
    return { status: res.status, latency: Date.now() - t0 }
  } catch (err) {
    return { status: null, latency: Date.now() - t0, error: String(err.message ?? err) }
  }
}

const terminal = (id, status, reason = null) => query(
  `UPDATE announce_outbox SET status = $2, suppress_reason = $3 WHERE id = $1`, [id, status, reason])

/**
 * Processa a outbox de um canal uma vez. Sem agendador: cada chamada faz no
 * máximo uma tentativa por item e reagenda a próxima em `not_before`
 * (2 s, depois 10 s). Três tentativas acontecem em três passadas — é o que
 * mantém a função rápida e sem timer em background.
 */
export async function processOutboxOnce (channelId, { now = Date.now(), fetchImpl = fetch, max = 25 } = {}) {
  const out = { sent: 0, failed: 0, expired: 0, suppressed: 0, retried: 0, aggregated: 0 }

  // R12: vencido nunca é tentado.
  const exp = await query(
    `UPDATE announce_outbox SET status = 'expired'
      WHERE channel_id = $1 AND status IN ('queued','sending') AND expires_at <= $2 RETURNING id`,
    [channelId, new Date(now)])
  out.expired = exp.rowCount

  const cfg = await getConfig(channelId)
  if (!cfg?.enabled || !cfg.webhook_url) return out                  // R1

  out.aggregated = await flushAggregates(channelId, now)

  const { rows: due } = await query(
    `SELECT o.*, g.status AS guild_status FROM announce_outbox o
       LEFT JOIN guild g ON g.id = o.guild_id
      WHERE o.channel_id = $1 AND o.status = 'queued' AND o.agg_window IS NULL
        AND o.not_before <= $2
      ORDER BY o.not_before, o.created_at LIMIT $3`,
    [channelId, new Date(now), max])
  if (!due.length) return out

  const { rows: sentRows } = await query(
    `SELECT sent_at FROM announce_outbox
      WHERE channel_id = $1 AND status = 'sent' AND sent_at > $2`,
    [channelId, new Date(now - 3_600_000)])
  const sentAt = sentRows.map(r => +new Date(r.sent_at))

  const secrets = await liveSecrets(channelId, now)
  let urlOk = null

  for (const item of due) {
    // R4: status da guilda reavaliado agora, não só na entrada.
    if (!guildEligible(item.guild_status)) {
      await terminal(item.id, 'suppressed', 'guild_ineligible')
      out.suppressed++
      continue
    }
    // R11: mute/quiet/offline valem também no dispatch.
    if (cfg.offline || (cfg.muted_until && +new Date(cfg.muted_until) > now) ||
        (cfg.quiet_from && inQuietHours(now, quietOf(cfg)))) {
      await terminal(item.id, 'suppressed',
        cfg.offline ? 'offline' : (cfg.muted_until && +new Date(cfg.muted_until) > now ? 'muted' : 'quiet_hours'))
      out.suppressed++
      continue
    }

    // R8/R9: teto horário, rajada e espaçamento, sempre no dispatch.
    const d = decide({
      priority: item.priority, onCooldown: 'ultimo', cooldownS: 0,
      hourlyCap: cfg.hourly_cap, sentAt,
    }, now)
    if (d.acao === 'suprimir') {
      await terminal(item.id, 'suppressed', d.motivo)
      out.suppressed++
      continue
    }
    if (d.notBefore > now) {
      await query('UPDATE announce_outbox SET not_before = $2 WHERE id = $1', [item.id, new Date(d.notBefore)])
      continue
    }

    if (urlOk === null) {
      urlOk = await assertPublicUrl(cfg.webhook_url).then(() => true, (e) => e.message)
    }
    if (urlOk !== true) {
      await terminal(item.id, 'failed', `webhook_blocked: ${urlOk}`)
      out.failed++
      await bumpFailure(channelId, cfg)
      continue
    }

    const attempt = item.attempts + 1
    const r = await sendOnce(item, cfg, secrets, attempt, fetchImpl, now)
    await query(
      `INSERT INTO announce_delivery_log (outbox_id, attempt, http_status, latency_ms, error)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [item.id, attempt, r.status, r.latency, r.error ?? null])

    if (r.status && r.status >= 200 && r.status < 300) {
      await query(
        `UPDATE announce_outbox SET status = 'sent', sent_at = $2, attempts = $3 WHERE id = $1`,
        [item.id, new Date(now), attempt])
      await query('UPDATE announce_config SET fail_streak = 0 WHERE channel_id = $1', [channelId])
      cfg.fail_streak = 0
      sentAt.push(now)
      out.sent++
      continue
    }

    const retriable = r.status === null || RETRIABLE(r.status)
    if (retriable && attempt < 3) {
      await query(
        `UPDATE announce_outbox SET attempts = $2, not_before = $3 WHERE id = $1`,
        [item.id, attempt, new Date(now + jitter(BACKOFF_MS[attempt - 1]))])
      out.retried++
      continue
    }
    await query(
      `UPDATE announce_outbox SET status = 'failed', attempts = $2, suppress_reason = $3 WHERE id = $1`,
      [item.id, attempt, r.error ?? `http ${r.status}`])
    out.failed++
    await bumpFailure(channelId, cfg)
  }
  return out
}

/** R19: 10 falhas consecutivas desligam o canal. Religar é manual. */
async function bumpFailure (channelId, cfg) {
  const { rows: [row] } = await query(
    `UPDATE announce_config SET fail_streak = fail_streak + 1, updated_at = now()
      WHERE channel_id = $1 RETURNING fail_streak`, [channelId])
  cfg.fail_streak = row.fail_streak
  if (row.fail_streak >= 10) {
    await query('UPDATE announce_config SET enabled = false WHERE channel_id = $1', [channelId])
    cfg.enabled = false
  }
}

/** POST /announce/test: entrega direta, fora do teto horário (R21). */
export async function deliverNow (channelId, itemId, { now = Date.now(), fetchImpl = fetch } = {}) {
  const cfg = await getConfig(channelId)
  const { rows: [item] } = await query('SELECT * FROM announce_outbox WHERE id = $1', [itemId])
  if (!cfg?.webhook_url || !item) return null
  await assertPublicUrl(cfg.webhook_url)
  const secrets = await liveSecrets(channelId, now)
  const r = await sendOnce(item, cfg, secrets, 1, fetchImpl, now)
  await query(
    `INSERT INTO announce_delivery_log (outbox_id, attempt, http_status, latency_ms, error)
     VALUES ($1,1,$2,$3,$4) ON CONFLICT DO NOTHING`, [itemId, r.status, r.latency, r.error ?? null])
  const ok = r.status >= 200 && r.status < 300
  await query(
    ok
      ? `UPDATE announce_outbox SET status = 'sent', sent_at = $2, attempts = 1 WHERE id = $1`
      : `UPDATE announce_outbox SET status = 'failed', attempts = 1, suppress_reason = $2 WHERE id = $1`,
    [itemId, ok ? new Date(now) : (r.error ?? `http ${r.status}`)])
  return r
}
