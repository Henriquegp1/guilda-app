import { createHash } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { query, tx } from '../../core/db.js'
import { emit, audit } from '../../core/events.js'
import { badRequest, conflict, forbidden, notFound, onUnique } from '../../core/errors.js'
import { requireModerator } from '../../core/auth.js'
import {
  ASSETS, BY_ID, CATALOG_VERSION, LAYERS, PAID_EFFECTS, BANNED_EMBLEM,
  applyFallbacks, defaultEmblem, emblemHash, normalizeLayers, priceOfAsset, renderUrl, validateEmblem,
} from './catalog.js'
import {
  ACTIVE_SWAPS_PER_HOUR, CREDIT_TTL_DAYS, EMBLEM_EDIT_COOLDOWN_S, IDENTITY_COOLDOWN_DAYS,
  IDENTITY_LOCK_DAYS, MAX_SLOTS, NAME_RESERVATION_DAYS, REPORTS_TO_REVIEW, SKU_BITS, SLOT_COOLDOWN_H,
  assetSku, creditBalance, creditLots, planPayment, skuPrice, verifyReceipt,
} from './economy.js'

const DB = { query: (text, params) => query(text, params) }
const norm = (v) => String(v ?? '').trim().toLowerCase()
const days = (n) => `${n} days`
const slotsOwned = (ents) => ents.slots.size + 1

// ---------------------------------------------------------------- contexto

/** O core já resolveu channel.id em req.auth (core/auth.js). */
function channelPk (_c, auth) {
  return auth.channelId
}

/**
 * Resolve canal + guilda + cargo do autor numa tacada. `roles` aplica R21
 * (rename/TAG/slot só líder; asset e brasão também oficial). `eligible` aplica
 * R23: guilda banida não compra e não publica nada.
 */
async function scope (c, req, { roles = null, eligible = false } = {}) {
  const channelId = req.auth.channelId
  const gid = Number(req.params.id ?? req.params.gid)
  const { rows } = await c.query(
    'SELECT id, name, tag, status, level FROM guild WHERE id = $1 AND channel_id = $2', [gid, channelId])
  const guild = rows[0]
  if (!guild) throw notFound('GUILD_NOT_FOUND', 'guilda não encontrada neste canal')

  if (eligible && ['banned', 'purged'].includes(guild.status)) {
    throw forbidden('GUILD_NOT_ELIGIBLE', 'guilda banida ou removida não altera identidade')
  }

  let role = null
  if (roles) {
    if (!req.auth.userId) throw forbidden('FORBIDDEN', 'requer identidade do viewer')
    const m = await c.query('SELECT role FROM guild_member WHERE guild_id = $1 AND user_id = $2',
      [guild.id, req.auth.userId])
    role = m.rows[0]?.role ?? null
    if (!roles.includes(role)) throw forbidden('FORBIDDEN', `requer cargo ${roles.join(' ou ')}`)
  }
  return { channelId, guild, role, userId: req.auth.userId }
}

async function entitlements (c, guildId) {
  const { rows } = await c.query('SELECT kind, ref FROM guild_entitlement WHERE guild_id = $1', [guildId])
  return {
    assets: new Set(rows.filter(r => r.kind === 'asset').map(r => r.ref)),
    slots: new Set(rows.filter(r => r.kind === 'slot').map(r => r.ref)),
  }
}

const CUSTOM_STORAGE = join(process.cwd(), 'public', 'custom-assets')
const MAX_IMAGE_SIZE = 1 * 1024 * 1024 // 1MB

async function ingestCustomImage (sourceUrl) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(sourceUrl, { signal: controller.signal })
    if (!res.ok) throw badRequest('IMAGE_DOWNLOAD_FAILED', `status ${res.status}`)

    const size = Number(res.headers.get('content-length'))
    if (size > MAX_IMAGE_SIZE) throw badRequest('IMAGE_TOO_LARGE', 'máximo 1MB')

    const type = res.headers.get('content-type')
    if (!type?.startsWith('image/')) throw badRequest('INVALID_IMAGE_TYPE', 'deve ser PNG ou JPG')

    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > MAX_IMAGE_SIZE) throw badRequest('IMAGE_TOO_LARGE', 'máximo 1MB')

    const hash = createHash('sha256').update(buffer).digest('hex')
    const ext = type === 'image/png' ? 'png' : 'jpg'
    const filename = `${hash}.${ext}`
    const path = join(CUSTOM_STORAGE, filename)

    await mkdir(CUSTOM_STORAGE, { recursive: true })
    await writeFile(path, buffer)

    return { hash, filename, type }
  } finally {
    clearTimeout(timeout)
  }
}

// ---------------------------------------------------------------- dinheiro

/**
 * Consumidor de `guild.rejected` (fase 01 → 06, docs/EVENTOS.md): guilda
 * rejeitada ganha crédito de 100% do que pagou na criação, válido 180 dias.
 * Roda por demanda antes de toda leitura de saldo — não há scheduler nesta fase
 * e o INSERT..SELECT é idempotente porque o `reason` carrega o id do evento.
 * R23: guilda banida não gera crédito.
 * Único ponto em que esta fase lê coluna de outra (`guild.bits_amount`, fase 01):
 * o valor pago não viaja no payload de `guild.rejected`.
 */
async function syncRejectionCredits (c, guildId) {
  await c.query(
    `INSERT INTO guild_identity_credit (channel_id, guild_id, delta_bits, reason, expires_at)
     SELECT e.channel_id, e.guild_id, g.bits_amount, 'rejected:guild:' || e.id, e.created_at + $2::interval
       FROM guild_event e JOIN guild g ON g.id = e.guild_id
      WHERE e.guild_id = $1 AND e.type = 'guild.rejected'
        AND g.bits_amount > 0 AND g.status <> 'banned'
        AND NOT EXISTS (SELECT 1 FROM guild_identity_credit c2
                         WHERE c2.guild_id = e.guild_id AND c2.reason = 'rejected:guild:' || e.id)`,
    [guildId, days(CREDIT_TTL_DAYS)])
}

/**
 * R18/R19/R20 — cobrança idempotente. Consome crédito FIFO, o resto em Bits com
 * recibo validado. Compra e entitlement saem na MESMA transação (quem chama já
 * está dentro de `tx`). Recibo repetido devolve o mesmo purchase_id sem cobrar.
 */
async function charge (c, { channelId, twitchChannelId, guildId, userId, sku, price, receipt = null, useCredit = false }) {
  await syncRejectionCredits(c, guildId)
  const { rows: ledger } = await c.query(
    'SELECT id, delta_bits, expires_at FROM guild_identity_credit WHERE guild_id = $1 ORDER BY created_at FOR UPDATE',
    [guildId])
  const lots = creditLots(ledger)
  const { creditUsed, bitsDue } = planPayment(price, lots, { useCredit })

  let transactionId = null
  if (bitsDue > 0) {
    if (!receipt) {
      throw badRequest(useCredit ? 'INSUFFICIENT_CREDIT' : 'PURCHASE_INVALID',
        `faltam ${bitsDue} Bits para ${sku}`)
    }
    transactionId = verifyReceipt(receipt, { channelId: twitchChannelId, minBits: bitsDue }).transactionId
  }

  const ins = await c.query(
    `INSERT INTO bits_purchase (channel_id, guild_id, user_id, sku, bits_amount, credit_amount,
                                transaction_id, state, settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'settled', now())
     ON CONFLICT (channel_id, transaction_id) WHERE transaction_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [channelId, guildId, userId, sku, bitsDue, creditUsed, transactionId])

  if (!ins.rows[0]) {                                   // recibo reenviado (R18)
    const { rows } = await c.query(
      'SELECT id FROM bits_purchase WHERE channel_id = $1 AND transaction_id = $2', [channelId, transactionId])
    return { purchaseId: rows[0].id, duplicate: true, creditUsed: 0, bitsDue: 0, creditRemaining: creditBalance(ledger) }
  }

  const purchaseId = ins.rows[0].id
  if (creditUsed > 0) {
    await c.query(
      `INSERT INTO guild_identity_credit (channel_id, guild_id, delta_bits, reason, purchase_id)
       VALUES ($1, $2, $3, 'spend', $4)`, [channelId, guildId, -creditUsed, purchaseId])
  }
  return { purchaseId, duplicate: false, creditUsed, bitsDue, creditRemaining: creditBalance(ledger) - creditUsed }
}

/** §8 — crédito de identidade: 100% do valor pago, 180 dias, intransferível. */
async function issueCredit (c, { channelId, guildId, bits, reason, purchaseId = null }) {
  if (bits <= 0) return 0
  await c.query(
    `INSERT INTO guild_identity_credit (channel_id, guild_id, delta_bits, reason, purchase_id, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + $6::interval)`,
    [channelId, guildId, bits, reason, purchaseId, days(CREDIT_TTL_DAYS)])
  return bits
}

// ---------------------------------------------------------------- brasão

async function deniedCombo (c, ids) {
  const { rows } = await c.query(
    'SELECT asset_ids, action, reason FROM emblem_denied_combo WHERE asset_ids <@ $1::text[]', [ids])
  return rows.find(r => r.action === 'block') ?? rows[0] ?? null
}

/**
 * Insere uma nova versão do brasão no slot. Nunca faz UPDATE destrutivo (§8):
 * a versão anterior vira 'reverted' e continua no histórico. `render_url` é
 * determinístico pelo hash — o job assíncrono só materializa os bytes (§4).
 */
async function publishCustomEmblem (c, { channelId, guild, slot, sourceUrl, asset, userId }) {
  // Brasões customizados SEMPRE entram em revisão (Segurança)
  const { rows } = await c.query(
    `INSERT INTO guild_emblem (channel_id, guild_id, slot_index, layers, catalog_version,
                               status, is_active, created_by,
                               custom_source_url, custom_asset_hash, custom_local_path)
     VALUES ($1, $2, $3, '{}', $4, 'pending_review', false, $5, $6, $7, $8)
     RETURNING id, status`,
    [channelId, guild.id, slot, CATALOG_VERSION, userId, sourceUrl, asset.hash, asset.filename])

  const emblem = rows[0]

  await c.query(
    `INSERT INTO guild_identity_history (channel_id, guild_id, field, old_value, new_value, requested_by, state)
     VALUES ($1, $2, 'emblem_custom', $3, $4, $5, 'pending_review')`,
    [channelId, guild.id, 'layered', sourceUrl, userId])

  return emblem
}

async function publishEmblem (c, { channelId, guild, slot, layers, userId, status = 'published' }) {
  const hash = emblemHash(layers)

  // R8: publicação em análise não desbanca a anterior — o público continua
  // vendo o brasão antigo, que nem sai de 'published'.
  const prev = status === 'published'
    ? await c.query(
      `UPDATE guild_emblem SET status = 'reverted', is_active = false
        WHERE guild_id = $1 AND slot_index = $2 AND status = 'published'
        RETURNING id, is_active`, [guild.id, slot])
    : await c.query(
      `SELECT id, is_active FROM guild_emblem
        WHERE guild_id = $1 AND slot_index = $2 AND status = 'published'`, [guild.id, slot])

  const live = await c.query('SELECT 1 FROM guild_emblem WHERE guild_id = $1 AND is_active', [guild.id])
  const active = status === 'published' && ((prev.rows[0]?.is_active ?? false) || !live.rows[0])

  const { rows } = await c.query(
    `INSERT INTO guild_emblem (channel_id, guild_id, slot_index, layers, catalog_version,
                               status, render_url, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, slot_index, status, render_url, is_active, layers, created_at`,
    [channelId, guild.id, slot, layers, CATALOG_VERSION, status, renderUrl(hash), active, userId])

  const emblem = rows[0]
  await emit(c, {
    channelId,
    guildId: guild.id,
    type: 'emblem.changed',
    actorUserId: userId,
    payload: { from_version: prev.rows[0]?.id ?? null, to_version: emblem.id, action: status, slot },
  })
  return { ...emblem, layers_hash: hash }
}

// ---------------------------------------------------------------- nome/TAG

// Formato é da fase 01 (guild_name_fmt_chk / guild_tag_fmt_chk). Repetimos aqui só
// para devolver NAME_INVALID no request em vez de estourar o CHECK na aprovação.
const validValue = (field, v) => field === 'name'
  ? /^[A-Za-z0-9][A-Za-z0-9 ]{1,22}[A-Za-z0-9]$/.test(v)
  : /^[A-Z0-9]{2,5}$/.test(v)

/** R14 — 3 rejeições consecutivas travam novas solicitações por 7 dias. */
async function identityLock (c, guildId) {
  const { rows } = await c.query(
    `SELECT state, reviewed_at FROM guild_identity_history
      WHERE guild_id = $1 AND state IN ('approved', 'rejected')
      ORDER BY created_at DESC LIMIT 3`, [guildId])
  if (rows.length < 3 || rows.some(r => r.state !== 'rejected')) return null
  const until = new Date(new Date(rows[0].reviewed_at).getTime() + IDENTITY_LOCK_DAYS * 864e5)
  return until > new Date() ? until : null
}

/** Fluxo comum de POST /identity/name e /identity/tag (R11..R14, R21). */
async function requestIdentityChange (req, field) {
  const { value, transaction_receipt: receipt, use_credit: useCredit = false } = req.body ?? {}
  const sku = field === 'name' ? 'guild.rename' : 'guild.tag'
  const ERR = field === 'name' ? 'NAME' : 'TAG'

  const next = typeof value === 'string'
    ? (field === 'tag' ? value.trim().toUpperCase() : value.trim())
    : ''
  if (!validValue(field, next)) throw badRequest(`${ERR}_INVALID`, `valor de ${field} inválido`)

  return tx(async (c) => {
    // R21: rename e TAG são exclusivos do líder.
    const { channelId, guild, userId } = await scope(c, req, { roles: ['lider'], eligible: true })
    const current = field === 'name' ? guild.name : guild.tag
    if (norm(current) === norm(next)) throw badRequest(`${ERR}_INVALID`, 'valor igual ao atual')

    const locked = await identityLock(c, guild.id)
    if (locked) throw forbidden('IDENTITY_LOCKED', `bloqueado até ${locked.toISOString()}`)

    const pending = await c.query(
      `SELECT id FROM guild_identity_history WHERE guild_id = $1 AND field = $2 AND state = 'pending_review'`,
      [guild.id, field])
    if (pending.rows[0]) throw conflict('IDENTITY_PENDING', 'já existe uma troca em análise para este campo')

    const taken = await c.query(
      `SELECT 1 FROM guild WHERE channel_id = $1 AND id <> $2 AND status <> 'purged'
         AND lower(CASE WHEN $3::text = 'name' THEN name ELSE tag END) = $4::text`,
      [channelId, guild.id, field, norm(next)])
    if (taken.rows[0]) throw conflict(`${ERR}_TAKEN`, 'valor já em uso neste canal')

    // R12 — quarentena de 30 dias: de terceiros bloqueia; da própria guilda é
    // retomada grátis, sem cooldown e sem nova fila (o valor já foi aprovado antes).
    const res = await c.query(
      `SELECT guild_id FROM guild_name_reservation
        WHERE channel_id = $1 AND field = $2 AND value_norm = $3 AND expires_at > now()`,
      [channelId, field, norm(next)])
    const reclaiming = res.rows[0]?.guild_id === guild.id
    if (res.rows[0] && !reclaiming) throw conflict(`${ERR}_RESERVED`, 'valor em quarentena de outra guilda')

    if (!reclaiming) {
      const last = await c.query(
        `SELECT reviewed_at FROM guild_identity_history
          WHERE guild_id = $1 AND field = $2 AND state = 'approved'
          ORDER BY reviewed_at DESC LIMIT 1`, [guild.id, field])
      const since = last.rows[0]?.reviewed_at
      if (since) {
        const free = new Date(new Date(since).getTime() + IDENTITY_COOLDOWN_DAYS * 864e5)
        if (free > new Date()) {
          throw conflict('IDENTITY_COOLDOWN',
            `retry_after=${Math.ceil((free - Date.now()) / 1000)}s`)
        }
      }
    }

    const paid = reclaiming
      ? { purchaseId: null, creditUsed: 0, bitsDue: 0, creditRemaining: null }
      : await charge(c, {
        channelId, twitchChannelId: req.auth.channelId, guildId: guild.id, userId,
        sku, price: SKU_BITS[sku], receipt, useCredit,
      })

    const state = reclaiming ? 'approved' : 'pending_review'
    const { rows } = await c.query(
      `INSERT INTO guild_identity_history (channel_id, guild_id, field, old_value, new_value,
                                           purchase_id, state, requested_by, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $7::text = 'approved' THEN now() END)
       RETURNING id`,
      [channelId, guild.id, field, current, next, paid.purchaseId, state, userId,
        reclaiming ? 'system:reclaim' : null])

    if (reclaiming) await applyIdentity(c, { channelId, guild, field, next, actorUserId: userId, actorRole: req.auth.role, action: 'reclaimed' })

    return { request_id: rows[0].id, state, credit_used: paid.creditUsed, purchase_id: paid.purchaseId }
  })
}

/**
 * Efetiva nome/TAG: troca o valor vivo, coloca o antigo em quarentena de 30 dias
 * (R12) e libera a quarentena do novo. R16: `guild.id` nunca muda.
 */
async function applyIdentity (c, { channelId, guild, field, next, actorUserId, actorRole = null, action }) {
  const previous = field === 'name' ? guild.name : guild.tag
  const col = field === 'name' ? 'name' : 'tag'

  // R15: a unicidade é revalidada aqui, no commit — outro nome pode ter passado antes.
  await c.query(`UPDATE guild SET ${col} = $1 WHERE id = $2`, [next, guild.id])
    .catch(onUnique(field === 'name' ? 'guild_name_uk' : 'guild_tag_uk',
      field === 'name' ? 'NAME_TAKEN' : 'TAG_TAKEN', 'valor tomado antes da aprovação'))

  await c.query(
    `INSERT INTO guild_name_reservation (channel_id, field, value_norm, guild_id, expires_at)
     VALUES ($1, $2, $3, $4, now() + $5::interval)
     ON CONFLICT (channel_id, field, value_norm)
     DO UPDATE SET guild_id = EXCLUDED.guild_id, expires_at = EXCLUDED.expires_at`,
    [channelId, field, norm(previous), guild.id, days(NAME_RESERVATION_DAYS)])

  await c.query(
    'DELETE FROM guild_name_reservation WHERE channel_id = $1 AND field = $2 AND value_norm = $3',
    [channelId, field, norm(next)])

  await audit(c, {
    channelId,
    actorUserId: actorUserId ?? 'system',
    actorRole,
    action: `identity.${action}`,
    target: `guild:${guild.id}:${field}`,
    before: { [field]: previous },
    after: { [field]: next },
  })
  await emit(c, {
    channelId,
    guildId: guild.id,
    type: 'identity.changed',
    actorUserId,
    payload: { field, from: previous, to: next, action },
  })
}

// ---------------------------------------------------------------- rotas

export default async function identity (app) {
  // -------------------------------------------------- catálogo
  app.get('/emblem/catalog', { config: { public: true } }, async (req) => {
    let rows = []
    try {
      const res = await query('SELECT asset_ids, action FROM emblem_denied_combo ORDER BY id')
      rows = res.rows
    } catch (e) {
      // Silencioso: se o banco estiver fora, o catálogo continua funcionando (R0)
      console.warn('EBS: banco fora, servindo catálogo em modo de compatibilidade')
    }
    return {
      version: CATALOG_VERSION,
      assets: ASSETS.map(a => ({
        id: a.id, layer: a.layer, tier: a.tier, status: a.status,
        render_type: a.render_type,
        price_bits: a.price, unlock_level: a.unlockLevel,
        svg_symbol_id: a.svgSymbolId, is_layer_fallback: a.isFallback,
        author: a.author
      })),
      sprite_url: 'catalog.svg',
      denied_combos_hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
      bundle: { sku: 'effect.bundle', price_bits: SKU_BITS['effect.bundle'], pick: 3, from: PAID_EFFECTS },
      prices: SKU_BITS,
    }
  })

  // -------------------------------------------------- leitura do brasão
  app.get('/guilds/:id/emblem', async (req) => {
    const { guild } = await scope(DB, req)
    if (guild.status === 'banned') return { active: { placeholder: BANNED_EMBLEM }, slots: [] }  // R22

    const { rows } = await query(
      `SELECT id, slot_index, layers, layers_hash, catalog_version, status, render_url, is_active
         FROM guild_emblem WHERE guild_id = $1 AND status IN ('published', 'pending_review')
        ORDER BY slot_index, created_at DESC`, [guild.id])
    return { active: rows.find(r => r.is_active) ?? null, slots: rows }
  })

  app.get('/guilds/:id/emblem/entitlements', async (req) => {
    const { guild } = await scope(DB, req)
    const ents = await entitlements(DB, guild.id)
    await syncRejectionCredits(DB, guild.id)
    const { rows } = await query(
      'SELECT id, delta_bits, expires_at FROM guild_identity_credit WHERE guild_id = $1 ORDER BY created_at',
      [guild.id])
    return {
      assets: [...ents.assets],
      slots_owned: slotsOwned(ents),
      credit_bits: creditBalance(rows),
      level: guild.level,
    }
  })

  app.post('/guilds/:id/emblem/preview', async (req) => {
    const { guild } = await scope(DB, req)
    const ents = await entitlements(DB, guild.id)
    const layers = normalizeLayers(req.body?.layers)
    const violations = validateEmblem(layers, { level: guild.level, entitlements: ents.assets })
    const combo = violations.length ? null : await deniedCombo(DB, LAYERS.map(l => layers[l]))
    return {
      valid: !violations.length && combo?.action !== 'block',
      violations: combo ? [...violations, { code: 'EMBLEM_COMBO_BLOCKED', assets: combo.asset_ids, action: combo.action }] : violations,
      render_url: violations.length ? null : renderUrl(emblemHash(layers)),
    }
  })

  // -------------------------------------------------- publicar brasão (R1..R8)
  app.put('/guilds/:id/emblem/slots/:slot', async (req) => {
    const slot = Number(req.params.slot)
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) throw badRequest('SLOT_NOT_OWNED', 'slot inexistente')

    return tx(async (c) => {
      const { channelId, guild, userId } = await scope(c, req, { roles: ['lider', 'sub-lider'], eligible: true })
      const ents = await entitlements(c, guild.id)
      if (slot > 1 && !ents.slots.has(`slot:${slot}`)) throw forbidden('SLOT_NOT_OWNED', `slot ${slot} não comprado`)

      const last = await c.query('SELECT max(created_at) AS at FROM guild_emblem WHERE guild_id = $1', [guild.id])
      if (last.rows[0].at && Date.now() - new Date(last.rows[0].at) < EMBLEM_EDIT_COOLDOWN_S * 1000) {
        throw conflict('RATE_LIMITED', `aguarde ${EMBLEM_EDIT_COOLDOWN_S}s entre edições de brasão`)
      }

      const layers = normalizeLayers(req.body?.layers)
      const violations = validateEmblem(layers, { level: guild.level, entitlements: ents.assets })
      if (violations.length) {
        // o primeiro código de violação vira o erro HTTP; a lista completa vai na mensagem.
        const code = violations.find(v => v.code !== 'MISSING_LAYER' && v.code !== 'UNKNOWN_ASSET')?.code ?? 'INVALID_LAYERS'
        throw badRequest(code, JSON.stringify(violations))
      }

      const combo = await deniedCombo(c, LAYERS.map(l => layers[l]))
      if (combo?.action === 'block') throw forbidden('EMBLEM_COMBO_BLOCKED', combo.reason)

      const emblem = await publishEmblem(c, {
        channelId, guild, slot, layers, userId,
        status: combo ? 'pending_review' : 'published',
      })
      return {
        emblem_id: emblem.id, status: emblem.status, render_url: emblem.render_url,
        layers_hash: emblem.layers_hash,
      }
    })
  })

  app.post('/guilds/:id/identity/custom-image', async (req) => {
    const { source_url, slot = 1 } = req.body ?? {}
    if (!source_url) throw badRequest('VALIDATION_ERROR', 'source_url obrigatória')
    const s = Number(slot)
    if (!Number.isInteger(s) || s < 1 || s > MAX_SLOTS) throw badRequest('SLOT_NOT_OWNED', 'slot inexistente')

    const asset = await ingestCustomImage(source_url)

    return tx(async (c) => {
      const { channelId, guild, userId } = await scope(c, req, { roles: ['lider', 'sub-lider'], eligible: true })
      const ents = await entitlements(c, guild.id)
      if (s > 1 && !ents.slots.has(`slot:${s}`)) throw forbidden('SLOT_NOT_OWNED', `slot ${s} não comprado`)

      const emblem = await publishCustomEmblem(c, {
        channelId, guild, slot: s, sourceUrl: source_url, asset, userId,
      })
      return { emblem_id: emblem.id, status: emblem.status }
    })
  })

  // R6 — trocar o brasão ativo é grátis e instantâneo, 10×/hora.
  app.post('/guilds/:id/emblem/active', async (req) => tx(async (c) => {
    const { channelId, guild, userId } = await scope(c, req, { roles: ['lider'], eligible: true })
    const slot = Number(req.body?.slot)

    const target = await c.query(
      `SELECT id FROM guild_emblem WHERE guild_id = $1 AND slot_index = $2 AND status = 'published'`,
      [guild.id, slot])
    if (!target.rows[0]) throw forbidden('SLOT_NOT_OWNED', 'slot vazio ou não publicado')

    const swaps = await c.query(
      `SELECT count(*)::int AS n FROM guild_event
        WHERE guild_id = $1 AND type = 'emblem.changed' AND payload->>'action' = 'activated'
          AND created_at > now() - interval '1 hour'`, [guild.id])
    if (swaps.rows[0].n >= ACTIVE_SWAPS_PER_HOUR) throw conflict('RATE_LIMITED', 'limite de trocas por hora')

    const from = await c.query(
      'UPDATE guild_emblem SET is_active = false WHERE guild_id = $1 AND is_active RETURNING id', [guild.id])
    await c.query('UPDATE guild_emblem SET is_active = true WHERE id = $1', [target.rows[0].id])
    await emit(c, {
      channelId,
      guildId: guild.id,
      type: 'emblem.changed',
      actorUserId: userId,
      payload: { from_version: from.rows[0]?.id ?? null, to_version: target.rows[0].id, action: 'activated', slot },
    })
    return { active_slot: slot }
  }))

  // -------------------------------------------------- loja
  app.post('/guilds/:id/emblem/slots', async (req) => tx(async (c) => {
    const { channelId, guild, userId } = await scope(c, req, { roles: ['lider'], eligible: true })
    const ents = await entitlements(c, guild.id)
    const next = slotsOwned(ents) + 1                    // R5: slots só em ordem
    if (next > MAX_SLOTS) throw conflict('SLOT_LIMIT_REACHED', `máximo de ${MAX_SLOTS} slots`)

    const last = await c.query(
      `SELECT max(created_at) AS at FROM bits_purchase WHERE guild_id = $1 AND sku = 'emblem.slot'`, [guild.id])
    if (last.rows[0].at && Date.now() - new Date(last.rows[0].at) < SLOT_COOLDOWN_H * 3600e3) {
      throw conflict('RATE_LIMITED', `aguarde ${SLOT_COOLDOWN_H}h entre compras de slot`)
    }

    const paid = await charge(c, {
      channelId, twitchChannelId: req.auth.channelId, guildId: guild.id, userId,
      sku: 'emblem.slot', price: SKU_BITS['emblem.slot'],
      receipt: req.body?.transaction_receipt, useCredit: req.body?.use_credit ?? false,
    })
    await c.query(
      `INSERT INTO guild_entitlement (channel_id, guild_id, kind, ref, source, purchase_id)
       VALUES ($1, $2, 'slot', $3, $4, $5) ON CONFLICT DO NOTHING`,
      [channelId, guild.id, `slot:${next}`, paid.creditUsed >= SKU_BITS['emblem.slot'] ? 'credit' : 'bits', paid.purchaseId])
    return { slot: next, purchase_id: paid.purchaseId, credit_remaining: paid.creditRemaining }
  }))

  app.post('/guilds/:id/store/assets', async (req) => tx(async (c) => {
    const { channelId, guild, userId } = await scope(c, req, { roles: ['lider', 'sub-lider'], eligible: true })
    const { asset_id: assetId, asset_ids: assetIds, transaction_receipt: receipt, use_credit: useCredit = false } = req.body ?? {}
    const ents = await entitlements(c, guild.id)

    // Pacote de efeitos (§6): 3 dos 4 efeitos pagos por 1000.
    const bundle = assetId === 'effect.bundle'
    const items = bundle ? (Array.isArray(assetIds) ? assetIds : []) : [assetId]

    if (bundle && (items.length !== 3 || items.some(i => !PAID_EFFECTS.includes(i)) || new Set(items).size !== 3)) {
      throw badRequest('ASSET_NOT_PURCHASABLE', 'pacote exige 3 efeitos pagos distintos')
    }
    if (!bundle) {
      // TRAVA DE DESIGN (§7, R3): priceOfAsset devolve null para tier 'level'.
      // Não existe atalho pago para asset travado por nível — nem aqui, nem em lugar nenhum.
      if (priceOfAsset(assetId) === null) {
        const a = BY_ID.get(assetId)
        throw badRequest('ASSET_NOT_PURCHASABLE', a?.tier === 'level'
          ? `${assetId} é desbloqueado por nível ${a.unlockLevel}, não por Bits`
          : `${assetId} não é vendável`)
      }
    }
    if (items.some(i => ents.assets.has(i))) throw conflict('ALREADY_OWNED', 'a guilda já possui esse asset')

    const sku = bundle ? 'effect.bundle' : assetSku(assetId)
    const price = skuPrice(sku)
    const paid = await charge(c, {
      channelId, twitchChannelId: req.auth.channelId, guildId: guild.id, userId,
      sku, price, receipt, useCredit,
    })

    const source = bundle ? 'bundle' : (paid.creditUsed >= price ? 'credit' : 'bits')
    for (const id of items) {
      await c.query(
        `INSERT INTO guild_entitlement (channel_id, guild_id, kind, ref, source, purchase_id)
         VALUES ($1, $2, 'asset', $3, $4, $5) ON CONFLICT DO NOTHING`,
        [channelId, guild.id, id, source, paid.purchaseId])
    }
    return { entitlement: items, purchase_id: paid.purchaseId, credit_remaining: paid.creditRemaining }
  }))

  // -------------------------------------------------- nome e TAG
  app.post('/guilds/:id/identity/name', (req) => requestIdentityChange(req, 'name'))
  app.post('/guilds/:id/identity/tag', (req) => requestIdentityChange(req, 'tag'))

  app.get('/guilds/:id/identity/history', async (req) => {
    const { guild } = await scope(DB, req)
    const limit = Math.min(Number(req.query.limit ?? 20), 100)
    const cursor = req.query.cursor ? Number(req.query.cursor) : null
    const { rows } = await query(
      `SELECT id, field, old_value, new_value, state, requested_by, reviewed_by, reviewed_at,
              reject_reason, created_at
         FROM guild_identity_history
        WHERE guild_id = $1 AND ($2::bigint IS NULL OR id < $2)
        ORDER BY id DESC LIMIT $3`, [guild.id, cursor, limit])
    return { items: rows, next_cursor: rows.length === limit ? rows[rows.length - 1].id : null }
  })

  // -------------------------------------------------- denúncia (R9)
  app.post('/guilds/:id/emblem/report', async (req) => tx(async (c) => {
    const { channelId, guild, userId } = await scope(c, req)
    if (!userId) throw forbidden('FORBIDDEN', 'requer identidade do viewer')

    const cur = await c.query(
      `SELECT id, slot_index, layers_hash FROM guild_emblem WHERE guild_id = $1 AND is_active`, [guild.id])
    if (!cur.rows[0]) throw notFound('GUILD_NOT_FOUND', 'guilda sem brasão ativo')
    const { id: emblemId, slot_index: slot, layers_hash: hash } = cur.rows[0]

    await c.query(
      `INSERT INTO emblem_report (channel_id, guild_id, layers_hash, reporter_user_id, reason)
       VALUES ($1, $2, $3, $4, $5)`, [channelId, guild.id, hash, userId, String(req.body?.reason ?? '')])
      .catch(onUnique('emblem_report_once_uq', 'ALREADY_REPORTED', 'você já denunciou este brasão'))

    const n = await c.query(
      `SELECT count(DISTINCT reporter_user_id)::int AS n FROM emblem_report
        WHERE channel_id = $1 AND layers_hash = $2 AND created_at > now() - interval '24 hours'`,
      [channelId, hash])

    // Exatamente na 3ª denúncia: reverte e abre item na fila. A 4ª não reabre nada.
    if (n.rows[0].n === REPORTS_TO_REVIEW) {
      await c.query(`UPDATE guild_emblem SET status = 'pending_review', is_active = false WHERE id = $1`, [emblemId])
      const prevRow = await c.query(
        `SELECT id FROM guild_emblem WHERE guild_id = $1 AND slot_index = $2 AND id <> $3 AND status = 'reverted'
          ORDER BY created_at DESC LIMIT 1`, [guild.id, slot, emblemId])
      if (prevRow.rows[0]) {
        await c.query(`UPDATE guild_emblem SET status = 'published', is_active = true WHERE id = $1`, [prevRow.rows[0].id])
      }
      await emit(c, {
        channelId,
        guildId: guild.id,
        type: 'emblem.changed',
        payload: { from_version: emblemId, to_version: prevRow.rows[0]?.id ?? null, action: 'under_review', slot },
      })
      return { reported: true, state: 'EMBLEM_UNDER_REVIEW' }
    }
    return { reported: true }
  }))

  // -------------------------------------------------- moderação
  app.get('/mod/identity/queue', async (req) => {
    requireModerator(req)
    const channelId = req.auth.channelId
    const type = req.query.type ?? null
    const limit = Math.min(Number(req.query.limit ?? 25), 100)

    const items = []
    if (type !== 'emblem') {
      const { rows } = await query(
        `SELECT h.id, h.guild_id, h.field, h.old_value, h.new_value, h.requested_by, h.created_at, g.name AS guild_name
           FROM guild_identity_history h JOIN guild g ON g.id = h.guild_id
          WHERE h.channel_id = $1 AND h.state = 'pending_review'
          ORDER BY h.created_at LIMIT $2`, [channelId, limit])
      items.push(...rows.map(r => ({
        request_id: `identity-${r.id}`,
        type: r.field,
        guild_name: r.guild_name,
        requested_by: r.requested_by,
        old_value: r.old_value,
        new_value: r.new_value,
        created_at: r.created_at
      })))
    }
    if (type !== 'name' && type !== 'tag') {
      const { rows } = await query(
        `SELECT e.id, e.guild_id, e.slot_index, e.layers, e.render_url, e.created_by, e.created_at,
                e.custom_local_path, g.name AS guild_name
           FROM guild_emblem e JOIN guild g ON g.id = e.guild_id
          WHERE e.channel_id = $1 AND e.status = 'pending_review'
          ORDER BY e.created_at LIMIT $2`, [channelId, limit])
      items.push(...rows.map(r => ({
        request_id: `emblem-${r.id}`,
        type: 'emblem',
        guild_name: r.guild_name,
        requested_by: r.created_by,
        layers: r.layers,
        png_url: r.custom_local_path ? `/custom-assets/${r.custom_local_path}` : r.render_url,
        created_at: r.created_at
      })))
    }
    return { items }
  })

  app.post('/mod/identity/:requestId/approve', async (req) => tx(async (c) => {
    requireModerator(req)
    const channelId = req.auth.channelId
    const [kind, rawId] = String(req.params.requestId).split('-')
    const id = Number(rawId)

    if (kind === 'emblem') {
      const { rows } = await c.query(
        `UPDATE guild_emblem SET status = 'published' WHERE id = $1 AND channel_id = $2 AND status = 'pending_review'
         RETURNING id, guild_id, slot_index`, [id, channelId])
      if (!rows[0]) throw conflict('REQUEST_ALREADY_RESOLVED', 'Este brasão já foi processado ou não está pendente')

      await c.query(
        `UPDATE guild_emblem SET is_active = false WHERE guild_id = $1 AND is_active AND id <> $2`,
        [rows[0].guild_id, rows[0].id])
      await c.query('UPDATE guild_emblem SET is_active = true WHERE id = $1', [rows[0].id])
      await audit(c, {
        channelId, actorUserId: req.auth.userId, actorRole: req.auth.role, action: 'emblem.approved', target: `emblem:${rows[0].id}`,
      })
      await emit(c, {
        channelId,
        guildId: rows[0].guild_id,
        type: 'emblem.changed',
        actorUserId: req.auth.userId,
        payload: { from_version: null, to_version: rows[0].id, action: 'approved', slot: rows[0].slot_index },
      })
      return { state: 'approved' }
    }

    const { rows } = await c.query(
      `SELECT h.*, g.name, g.tag, g.status FROM guild_identity_history h JOIN guild g ON g.id = h.guild_id
        WHERE h.id = $1 AND h.channel_id = $2 FOR UPDATE OF h`, [id, channelId])
    const r = rows[0]
    if (!r) throw notFound('NOT_PENDING', 'solicitação inexistente')
    if (r.state !== 'pending_review') throw conflict('NOT_PENDING', `estado atual: ${r.state}`)

    await applyIdentity(c, {
      channelId,
      guild: { id: r.guild_id, name: r.name, tag: r.tag },
      field: r.field,
      next: r.new_value,
      actorUserId: req.auth.userId,
      actorRole: req.auth.role,
      action: 'approved',
    })
    await c.query(
      `UPDATE guild_identity_history SET state = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
      [id, req.auth.userId])

    if (r.field === 'emblem_custom') {
      const { rows: [emblem] } = await c.query(
        "SELECT id FROM guild_emblem WHERE guild_id = $1 AND custom_source_url = $2 AND status = 'pending_review'",
        [r.guild_id, r.new_value])
      if (emblem) {
        await c.query("UPDATE guild_emblem SET is_active = false WHERE guild_id = $1 AND is_active = true", [r.guild_id])
        await c.query("UPDATE guild_emblem SET status = 'published', is_active = true WHERE id = $1", [emblem.id])
      }
    }

    return { state: 'approved' }
  }))

  app.post('/mod/identity/:requestId/reject', async (req) => tx(async (c) => {
    requireModerator(req)
    const channelId = req.auth.channelId
    const [kind, rawId] = String(req.params.requestId).split('-')
    const id = Number(rawId)

    if (kind === 'emblem') {
      const { rows } = await c.query(
        `UPDATE guild_emblem SET status = 'reverted' WHERE id = $1 AND channel_id = $2 AND status = 'pending_review'
         RETURNING id, guild_id`, [id, channelId])
      if (!rows[0]) throw conflict('REQUEST_ALREADY_RESOLVED', 'Este brasão já foi processado ou não está pendente')
      await audit(c, {
        channelId, actorUserId: req.auth.userId, actorRole: req.auth.role, action: 'emblem.rejected', target: `emblem:${rows[0].id}`,
        after: { reason: req.body?.reason ?? null },
      })
      await emit(c, {
        channelId,
        guildId: rows[0].guild_id,
        type: 'emblem.changed',
        actorUserId: req.auth.userId,
        payload: { from_version: rows[0].id, to_version: null, action: 'rejected' },
      })
      return { state: 'rejected', credit_issued_bits: 0 }   // brasão não custa Bits (§6)
    }

    const { rows } = await c.query(
      `SELECT h.*, p.bits_amount, p.credit_amount FROM guild_identity_history h
         LEFT JOIN bits_purchase p ON p.id = h.purchase_id
        WHERE h.id = $1 AND h.channel_id = $2 FOR UPDATE OF h`, [id, channelId])
    const r = rows[0]
    if (!r) throw notFound('NOT_PENDING', 'solicitação inexistente')
    if (r.state !== 'pending_review') throw conflict('NOT_PENDING', `estado atual: ${r.state}`)

    await c.query(
      `UPDATE guild_identity_history
          SET state = 'rejected', reviewed_by = $2, reviewed_at = now(), reject_reason = $3 WHERE id = $1`,
      [id, req.auth.userId, String(req.body?.reason ?? 'sem motivo')])

    if (r.field === 'emblem_custom') {
      await c.query(
        "UPDATE guild_emblem SET status = 'reverted' WHERE guild_id = $1 AND custom_source_url = $2 AND status = 'pending_review'",
        [r.guild_id, r.new_value])
    }

    // R14/§8: crédito de 100% do que foi pago (Bits + crédito já consumido).
    const credited = await issueCredit(c, {
      channelId,
      guildId: r.guild_id,
      bits: (r.bits_amount ?? 0) + (r.credit_amount ?? 0),
      reason: `rejected:${r.field}`,
      purchaseId: r.purchase_id,
    })
    await audit(c, {
      channelId, actorUserId: req.auth.userId, actorRole: req.auth.role, action: 'identity.rejected',
      target: `guild:${r.guild_id}:${r.field}`,
      before: { [r.field]: r.old_value }, after: { requested: r.new_value, credit_bits: credited },
    })
    await emit(c, {
      channelId,
      guildId: r.guild_id,
      type: 'identity.changed',
      actorUserId: req.auth.userId,
      payload: { field: r.field, from: r.old_value, to: r.old_value, action: 'rejected', requested: r.new_value },
    })

    const locked = await identityLock(c, r.guild_id)
    return { state: 'rejected', credit_issued_bits: credited, locked_until: locked?.toISOString() ?? null }
  }))

  /** §8 — reverter é sempre INSERT de nova versão apontando para a antiga. */
  app.post('/mod/guilds/:id/identity/revert', async (req) => tx(async (c) => {
    requireModerator(req)
    const { channelId, guild } = await scope(c, req)
    const field = req.body?.field
    const reason = String(req.body?.reason ?? 'reversão de moderação')

    if (field === 'emblem') {
      const cur = await c.query('SELECT id, slot_index FROM guild_emblem WHERE guild_id = $1 AND is_active', [guild.id])
      if (!cur.rows[0]) throw conflict('NOTHING_TO_REVERT', 'guilda sem brasão ativo')
      const prev = await c.query(
        `SELECT id, layers FROM guild_emblem WHERE guild_id = $1 AND id <> $2 AND status = 'reverted'
          ORDER BY created_at DESC LIMIT 1`, [guild.id, cur.rows[0].id])
      if (!prev.rows[0]) throw conflict('NOTHING_TO_REVERT', 'não há versão anterior do brasão')

      const emblem = await publishEmblem(c, {
        channelId, guild, slot: cur.rows[0].slot_index,
        layers: applyFallbacks(prev.rows[0].layers), userId: req.auth.userId,
      })
      await audit(c, {
        channelId, actorUserId: req.auth.userId, actorRole: req.auth.role, action: 'emblem.reverted',
        target: `guild:${guild.id}:emblem`, before: { emblem_id: cur.rows[0].id },
        after: { emblem_id: emblem.id, reason },
      })
      return { reverted_to: emblem.id }
    }

    if (field !== 'name' && field !== 'tag') throw badRequest('NOTHING_TO_REVERT', 'campo inválido')

    const { rows } = await c.query(
      `SELECT id, old_value, new_value FROM guild_identity_history
        WHERE guild_id = $1 AND field = $2 AND state = 'approved' ORDER BY reviewed_at DESC LIMIT 1`,
      [guild.id, field])
    if (!rows[0]) throw conflict('NOTHING_TO_REVERT', 'sem troca aprovada para reverter')
    const back = rows[0].old_value

    await c.query(`UPDATE guild_identity_history SET state = 'reverted' WHERE id = $1`, [rows[0].id])
    await c.query(
      `INSERT INTO guild_identity_history (channel_id, guild_id, field, old_value, new_value, state,
                                           requested_by, reviewed_by, reviewed_at, reject_reason)
       VALUES ($1, $2, $3, $4, $5, 'approved', $6, $6, now(), $7)`,
      [channelId, guild.id, field, field === 'name' ? guild.name : guild.tag, back, req.auth.userId, reason])

    await applyIdentity(c, { channelId, guild, field, next: back, actorUserId: req.auth.userId, actorRole: req.auth.role, action: 'reverted' })
    return { reverted_to: back }
  }))

  app.post('/mod/emblem/combos', async (req) => {
    requireModerator(req)
    if (req.auth.role !== 'broadcaster') throw forbidden('FORBIDDEN', 'só o broadcaster edita a denylist')
    const ids = [...new Set(req.body?.asset_ids ?? [])].sort()
    if (ids.length < 2 || ids.length > 3 || ids.some(i => !BY_ID.has(i))) {
      throw badRequest('INVALID_LAYERS', 'combo precisa de 2 ou 3 asset ids válidos')
    }
    const action = req.body?.action === 'block' ? 'block' : 'review'
    const { rows } = await query(
      `INSERT INTO emblem_denied_combo (asset_ids, action, reason, created_by)
       VALUES ($1::text[], $2, $3, $4) RETURNING id`,
      [ids, action, String(req.body?.reason ?? ''), req.auth.userId ?? 'broadcaster'])
      .catch(onUnique('emblem_denied_combo_asset_ids_key', 'COMBO_EXISTS', 'combinação já listada'))
    return { id: rows[0].id }
  })
}

/**
 * R10 / §5 — corpo do job de manutenção do catálogo: todo brasão publicado que
 * usa asset `revoked` é reescrito com o fallback grátis da camada (nova versão,
 * nunca UPDATE destrutivo) e quem pagou pelo asset recebe crédito de 100%.
 * Não há scheduler nesta fase: quem chama é o worker da fila (ou um `npm run`
 * pós-publicação de catálogo). Idempotente — rodar duas vezes não credita duas.
 */
export async function reconcileRevokedEmblems (client, { channelId }) {
  const revoked = ASSETS.filter(a => a.status === 'revoked').map(a => a.id)
  if (!revoked.length) return { rewritten: 0, credited: 0 }

  const { rows } = await client.query(
    `SELECT id, guild_id, slot_index, layers FROM guild_emblem
      WHERE channel_id = $1 AND status = 'published'`, [channelId])

  let rewritten = 0
  for (const row of rows) {
    if (!LAYERS.some(l => revoked.includes(row.layers[l]))) continue
    await publishEmblem(client, {
      channelId,
      guild: { id: row.guild_id },
      slot: row.slot_index,
      layers: applyFallbacks(row.layers),
      userId: 'system:catalog',
    })
    rewritten++
  }

  const credit = await client.query(
    `INSERT INTO guild_identity_credit (channel_id, guild_id, delta_bits, reason, purchase_id, expires_at)
     SELECT e.channel_id, e.guild_id, p.bits_amount + p.credit_amount, 'asset_revoked:' || e.ref,
            p.id, now() + $2::interval
       FROM guild_entitlement e
       JOIN bits_purchase p ON p.id = e.purchase_id AND p.sku = 'asset.' || e.ref
       JOIN guild g ON g.id = e.guild_id
      WHERE e.channel_id = $1 AND e.ref = ANY($3::text[]) AND g.status <> 'banned'
        AND NOT EXISTS (SELECT 1 FROM guild_identity_credit c
                         WHERE c.guild_id = e.guild_id AND c.reason = 'asset_revoked:' || e.ref)
     RETURNING id`,
    [channelId, days(CREDIT_TTL_DAYS), revoked])

  return { rewritten, credited: credit.rowCount }
}

/**
 * Usada pela fase 01 no fluxo de criação: toda guilda nasce com o brasão de
 * fallback no slot 1, ativo e grátis (R4). Exportada para não obrigar a fase 01
 * a conhecer o esquema desta fase.
 */
export async function createDefaultEmblem (client, { channelId, guildId, userId }) {
  const layers = defaultEmblem()
  const { rows } = await client.query(
    `INSERT INTO guild_emblem (channel_id, guild_id, slot_index, layers, catalog_version,
                               status, render_url, is_active, created_by)
     VALUES ($1, $2, 1, $3, $4, 'published', $5, true, $6) RETURNING id`,
    [channelId, guildId, layers, CATALOG_VERSION, renderUrl(emblemHash(layers)), userId])
  return rows[0].id
}
