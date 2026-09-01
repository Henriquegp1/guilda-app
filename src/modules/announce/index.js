import { query, tx } from '../../core/db.js'
import { requireModerator } from '../../core/auth.js'
import { audit } from '../../core/events.js'
import { badRequest, forbidden, notFound, AppError } from '../../core/errors.js'
import { CATALOG, DEFAULT_TEMPLATES, DEFAULT_TEMPLATES_AGG } from './catalog.js'
import { validateTemplate, renderMessage } from './template.js'
import { TTL_MS } from './ratelimit.js'
import { encryptSecret, newSecret, verifySignature } from './sign.js'
import {
  assertPublicUrl, deliverNow, getConfig, liveSecrets, ulid, varsFromEvent,
} from './worker.js'

export { ingestOnce, processOutboxOnce, flushAggregates } from './worker.js'

/** §7: só o broadcaster grava a configuração de anúncios. */
function requireBroadcaster (req) {
  requireModerator(req)
  if (req.auth.role !== 'broadcaster') throw forbidden('FORBIDDEN', 'requer broadcaster')
}

/** Só a rota de mute, que não passa pelo authenticate, resolve por twitch id. */
async function channelPkByTwitchId (twitchChannelId) {
  const { rows } = await query('SELECT id FROM channel WHERE twitch_channel_id = $1', [String(twitchChannelId)])
  if (!rows[0]) throw notFound('CHANNEL_NOT_FOUND', 'canal desconhecido')
  return rows[0].id
}

/** Cria a config e semeia os eventos do catálogo com o padrão da §3. */
async function ensureConfig (channelId) {
  const c = { query }
  await tx(async (tc) => {
    await tc.query('INSERT INTO announce_config (channel_id) VALUES ($1) ON CONFLICT DO NOTHING', [channelId])
    for (const [type, cat] of Object.entries(CATALOG)) {
      await tc.query(
        `INSERT INTO announce_event_config (channel_id, event_type, enabled, cooldown_s)
         VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [channelId, type, cat.enabled, cat.cooldownS])
    }
  })
  return getConfig(c, channelId)
}

const publicConfig = (cfg, events) => ({
  enabled: cfg.enabled,
  webhook_url: cfg.webhook_url,
  hourly_cap: cfg.hourly_cap,
  quiet_from: cfg.quiet_from,
  quiet_to: cfg.quiet_to,
  timezone: cfg.timezone,
  muted_until: cfg.muted_until,
  offline: cfg.offline,
  fail_streak: cfg.fail_streak,          // §11: o segredo nunca sai daqui
  events,
})

const listEvents = async (channelId) => {
  const { rows } = await query(
    `SELECT event_type, enabled, template, template_agg, cooldown_s
       FROM announce_event_config WHERE channel_id = $1 ORDER BY event_type`, [channelId])
  return rows.map(r => ({
    ...r,
    priority: CATALOG[r.event_type]?.priority,
    default_template: DEFAULT_TEMPLATES[r.event_type],
    default_template_agg: DEFAULT_TEMPLATES_AGG[r.event_type] ?? null,
  }))
}

export default async function announce (app) {
  // POST/DELETE /announce/mute vêm do bot, assinados com HMAC — não têm JWT nem
  // token de canal, e o `authenticate` do server.js roda como preHandler para
  // todo o escopo. Um onRequest corre antes dele e responde a rota inteira aqui.
  // (Faltou no core um jeito de marcar rota como não-autenticada; ver relatório.)
  app.addHook('onRequest', async (req, reply) => {
    if (!req.routeOptions?.url?.endsWith('/announce/mute')) return
    if (!req.headers['x-guilds-signature']) return               // config usa o caminho normal

    const raw = await readRaw(req)
    // Header do bot não cria canal: id inventado é 404, não linha nova.
    const channelId = await channelPkByTwitchId(req.headers['x-guilds-channel-id'] ?? '')
    const secrets = await liveSecrets({ query }, channelId)
    const ok = verifySignature({
      header: req.headers['x-guilds-signature'],
      timestamp: req.headers['x-guilds-timestamp'],
      body: raw, secrets, now: Date.now(),
    })
    if (!ok) throw new AppError(401, 'SIGNATURE_INVALID', 'assinatura inválida')

    await ensureConfig(channelId)
    if (req.method === 'DELETE') {
      await setMute(channelId, null, 'bot', null)
    } else {
      const { minutes, reason } = raw ? JSON.parse(raw) : {}
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
        throw badRequest('MUTE_RANGE', 'minutes deve estar entre 1 e 240')
      }
      await setMute(channelId, new Date(Date.now() + minutes * 60_000), 'bot', reason)
    }
    return reply.code(204).send()
  })

  // Rotas registradas para o roteador achar o caminho; o hook acima responde
  // quando vem assinado, e a config (broadcaster) cai aqui.
  app.post('/announce/mute', async (req, reply) => {
    requireBroadcaster(req)
    const channelId = req.auth.channelId
    const { minutes, reason } = req.body ?? {}
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) {
      throw badRequest('MUTE_RANGE', 'minutes deve estar entre 1 e 240')
    }
    await ensureConfig(channelId)
    await setMute(channelId, new Date(Date.now() + minutes * 60_000), req.auth.userId, reason)
    return reply.code(204).send()
  })

  app.delete('/announce/mute', async (req, reply) => {
    requireBroadcaster(req)
    const channelId = req.auth.channelId
    await setMute(channelId, null, req.auth.userId, null)
    return reply.code(204).send()
  })

  app.get('/announce/config', async (req) => {
    requireModerator(req)
    const channelId = req.auth.channelId
    const cfg = await ensureConfig(channelId)
    return publicConfig(cfg, await listEvents(channelId))
  })

  app.put('/announce/config', async (req) => {
    requireBroadcaster(req)
    const channelId = req.auth.channelId
    const before = await ensureConfig(channelId)
    const b = req.body ?? {}

    const cap = b.hourly_cap ?? before.hourly_cap
    if (!Number.isInteger(cap) || cap < 4 || cap > 20) throw badRequest('CAP_OUT_OF_RANGE', 'hourly_cap fora de 4–20')

    const url = 'webhook_url' in b ? b.webhook_url : before.webhook_url
    if (url) {
      // §11: valida na gravação; o dispatch revalida (DNS muda).
      await assertPublicUrl(url).catch(e => { throw badRequest('WEBHOOK_URL_INVALID', e.message) })
    }
    const enabled = b.enabled ?? before.enabled
    if (enabled && !url) throw badRequest('WEBHOOK_URL_INVALID', 'enabled exige webhook_url')

    const quietFrom = 'quiet_from' in b ? b.quiet_from : before.quiet_from
    const quietTo = 'quiet_to' in b ? b.quiet_to : before.quiet_to
    if ((quietFrom == null) !== (quietTo == null)) throw badRequest('QUIET_HOURS_INVALID', 'quiet_from e quiet_to andam juntos')

    // R2: só a ativação move o corte do backlog. R22: mexer na URL não rotaciona.
    const activating = enabled && !before.enabled
    const { rows: [cfg] } = await query(
      `UPDATE announce_config SET enabled=$2, webhook_url=$3, hourly_cap=$4,
              quiet_from=$5, quiet_to=$6, timezone=$7,
              enabled_at = CASE WHEN $8 THEN now() ELSE enabled_at END,
              fail_streak = CASE WHEN $8 THEN 0 ELSE fail_streak END,
              updated_at = now()
        WHERE channel_id=$1 RETURNING *`,
      [channelId, enabled, url, cap, quietFrom, quietTo, b.timezone ?? before.timezone, activating])

    await tx(c => audit(c, {
      channelId, actorUserId: req.auth.userId, actorRole: req.auth.role, action: 'announce.config_updated',
      target: `channel:${channelId}`, before: publicConfig(before, []), after: publicConfig(cfg, []),
    }))
    return publicConfig(cfg, await listEvents(channelId))
  })

  app.put('/announce/events/:type', async (req) => {
    requireBroadcaster(req)
    const type = req.params.type
    if (!CATALOG[type]) throw notFound('UNKNOWN_EVENT_TYPE', `${type} não é anunciável`)
    const channelId = req.auth.channelId
    await ensureConfig(channelId)

    const b = req.body ?? {}
    const cd = b.cooldown_s ?? CATALOG[type].cooldownS
    if (!Number.isInteger(cd) || cd < 30 || cd > 86400) throw badRequest('COOLDOWN_OUT_OF_RANGE', 'cooldown_s fora de 30–86400')
    // R17: template inválido nunca é salvo.
    const tpl = 'template' in b ? validateTemplate(b.template, type) : undefined
    const agg = 'template_agg' in b ? validateTemplate(b.template_agg, type, true) : undefined
    // §5: template salvo vazio equivale a desligar o evento.
    const enabled = b.template === '' ? false : (b.enabled ?? null)

    const { rows: [row] } = await query(
      `UPDATE announce_event_config
          SET enabled = coalesce($3, enabled),
              template = CASE WHEN $6 THEN $4 ELSE template END,
              template_agg = CASE WHEN $7 THEN $5 ELSE template_agg END,
              cooldown_s = $8, updated_at = now()
        WHERE channel_id = $1 AND event_type = $2 RETURNING *`,
      [channelId, type, enabled, tpl ?? null, agg ?? null,
        'template' in b, 'template_agg' in b, cd])
    return row
  })

  app.post('/announce/secret/rotate', async (req) => {
    requireBroadcaster(req)
    const channelId = req.auth.channelId
    await ensureConfig(channelId)

    const { rows: [last] } = await query(
      'SELECT max(created_at) AS at FROM announce_secret WHERE channel_id = $1', [channelId])
    if (last.at && Date.now() - +new Date(last.at) < 3_600_000) {
      throw new AppError(429, 'ROTATE_TOO_SOON', 'rotação limitada a 1 por hora')
    }

    const plain = newSecret()
    const retiresAt = new Date(Date.now() + 24 * 3_600_000)   // §11: dupla assinatura por 24 h
    await tx(async (c) => {
      await c.query(
        `UPDATE announce_secret SET status = 'revoked' WHERE channel_id = $1 AND status = 'retiring'`,
        [channelId])
      await c.query(
        `UPDATE announce_secret SET status = 'retiring', retires_at = $2
          WHERE channel_id = $1 AND status = 'active'`, [channelId, retiresAt])
      await c.query(
        `INSERT INTO announce_secret (channel_id, secret_enc, status) VALUES ($1,$2,'active')`,
        [channelId, encryptSecret(plain)])
      await audit(c, {
        channelId, actorUserId: req.auth.userId, actorRole: req.auth.role, action: 'announce.secret_rotated',
        target: `channel:${channelId}`,
      })
    })
    return { secret: plain, retires_at: retiresAt }   // texto claro só aqui, uma vez
  })

  app.post('/announce/test', async (req, reply) => {
    requireBroadcaster(req)
    const type = req.body?.event_type
    if (!CATALOG[type]) throw notFound('UNKNOWN_EVENT_TYPE', `${type} não é anunciável`)
    const channelId = req.auth.channelId
    const cfg = await ensureConfig(channelId)
    if (!cfg.enabled || !cfg.webhook_url) throw badRequest('ANNOUNCE_DISABLED', 'anúncios desligados')

    const { rows: [recent] } = await query(
      `SELECT count(*)::int n FROM announce_outbox
        WHERE channel_id = $1 AND dedup_key LIKE 'test:%' AND created_at > now() - interval '1 minute'`,
      [channelId])
    if (recent.n) throw new AppError(429, 'TEST_RATE_LIMITED', 'um teste por minuto')

    const { rows: [ec] } = await query(
      'SELECT template FROM announce_event_config WHERE channel_id = $1 AND event_type = $2', [channelId, type])
    const vars = fixtureVars(type, req.auth.channelId)
    const { message } = renderMessage({ eventType: type, template: ec?.template, vars })

    const id = ulid()
    const now = new Date()
    const payload = {
      id,
      channel_id: req.auth.channelId,
      event: type,
      priority: CATALOG[type].priority,
      occurred_at: now.toISOString(),
      message,
      aggregate: { count: 1, window_s: 0 },
      vars,
    }
    await query(
      `INSERT INTO announce_outbox
         (id, channel_id, event_type, priority, dedup_key, message, payload, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, channelId, type, CATALOG[type].priority, `test:${id}`, message, payload,
        new Date(+now + TTL_MS)])
    // R21: entrega direta, não conta no teto horário.
    await deliverNow(channelId, id).catch(err => req.log.warn({ err }, 'announce test'))
    return reply.code(202).send({ delivery_id: id })
  })

  app.get('/announce/deliveries', async (req) => {
    requireModerator(req)
    const channelId = req.auth.channelId
    const limit = Math.min(Number(req.query.limit) || 50, 100)
    const { rows } = await query(
      `SELECT o.id, o.event_type, o.status, o.suppress_reason, o.message, o.aggregate_count,
              o.created_at, o.dedup_key, d.http_status, d.latency_ms, d.error
         FROM announce_outbox o
         LEFT JOIN LATERAL (
           SELECT http_status, latency_ms, error FROM announce_delivery_log
            WHERE outbox_id = o.id ORDER BY attempt DESC LIMIT 1) d ON true
        WHERE o.channel_id = $1 AND ($2::text IS NULL OR o.id < $2)
        ORDER BY o.id DESC LIMIT $3`,
      [channelId, req.query.cursor ?? null, limit])
    return { items: rows, next_cursor: rows.length === limit ? rows[rows.length - 1].id : null }
  })
}

async function setMute (channelId, until, actorUserId, reason) {
  await tx(async (c) => {
    await c.query('UPDATE announce_config SET muted_until = $2, updated_at = now() WHERE channel_id = $1',
      [channelId, until])
    await audit(c, {
      channelId, actorUserId: actorUserId ?? 'bot', actorRole: actorUserId ? 'broadcaster' : 'bot', action: 'announce.muted',
      target: `channel:${channelId}`, after: { muted_until: until, reason: reason ?? null },
    })
  })
}

async function readRaw (req) {
  const chunks = []
  for await (const c of req.raw) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

/** Dados fictícios do preview e do Enviar teste (§5). Sem nada de R20. */
function fixtureVars (type, canal) {
  return varsFromEvent({
    type,
    channel_name: canal,
    guild_name: 'Ordem Carmesim', guild_tag: 'ORDM',
    guild_level: 7, guild_prestige: 14520, member_count: 18,
    created_at: new Date(),
    payload: {
      lider: 'Foyth', from: 6, to: 7, unlocks: ['Emblema animado'],
      opponent_name: 'Eclipse', opponent_tag: 'ECL', format: '48 h',
      winner_name: 'Ordem Carmesim', score: '3 x 1',
      territory_name: 'Vale Sombrio', previous_guild_name: 'Void',
      achievement_name: 'Primeiro Sangue', rarity: 'legendary',
      name: 'Temporada 3', ends_at: '30/09', podium: ['Ordem Carmesim', 'Eclipse', 'Void'],
      vagas: 4, modo: 'aberta',
    },
  })
}
