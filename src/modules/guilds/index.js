import { pool, query, tx } from '../../core/db.js'
import { audit, emit } from '../../core/events.js'
import { AppError, badRequest, conflict, forbidden, onUnique } from '../../core/errors.js'
import { checkReceipt, decodeReceipt } from './bits.js'
import { DRAFT_TTL, getChannel, isMod, loadGuild, pageLimit, requireUser, view } from './queries.js'
import { nextStatus } from './status.js'
import { parseForm } from './validate.js'
import modRoutes from './mod.js'

/**
 * R15: 3 criações por hora e 10 por dia, por user_id, com `!criarguilda` no
 * mesmo balde (o bot chama createDraft igual ao painel).
 * ponytail: balde em memória — zera no restart e não cruza processos. Redis já
 * está na stack (ARQUITETURA); trocar quando o EBS rodar em mais de um nó.
 */
const buckets = new Map()
const HOUR = 3600e3
const DAY = 24 * HOUR

function rateLimit (userId) {
  // Ignora o rate limit se estivermos em desenvolvimento ou se for um teste local
  if (process.env.NODE_ENV === 'development') return

  const now = Date.now()
  const hits = (buckets.get(userId) ?? []).filter((t) => now - t < DAY)
  if (hits.length >= 10 || hits.filter((t) => now - t < HOUR).length >= 3) {
    throw new AppError(429, 'RATE_LIMITED', 'limite de criação de guilda atingido')
  }
  buckets.set(userId, [...hits, now])
}

const nameTaken = onUnique('guild_name_uk', 'GUILD_NAME_TAKEN', 'nome já usado neste canal')
const tagTaken = onUnique('guild_tag_uk', 'GUILD_TAG_TAKEN', 'TAG já usada neste canal')
const oneGuild = onUnique('guild_one_per_leader_uk', 'ALREADY_HAS_GUILD', 'você já lidera uma guilda neste canal')

/** Rascunho `awaiting`: ocupa nome/TAG por 15 min e some com o reaper (R6, R7). */
async function insertDraft (client, channel, userId, form) {
  const { rows } = await client.query(
    `INSERT INTO guild (channel_id, name, tag, description, motto,
                        color_primary, color_secondary, emblem_preset,
                        creator_user_id, leader_user_id, status, payment_status,
                        reserved_until, member_limit)
     VALUES ($1, $2, $3, $4, $5,
             COALESCE($6, '#9146FF'), COALESCE($7, '#EFEFF1'), $8,
             $9, $9, 'awaiting', 'awaiting',
             now() + $10::interval, $11)
     RETURNING *`,
    [channel.id, form.name, form.tag ?? null, form.description ?? null, form.motto ?? null,
      form.color_primary ?? null, form.color_secondary ?? null, form.emblem_preset ?? null,
      userId, DRAFT_TTL, channel.settings.default_member_limit])
    .catch(nameTaken).catch(tagTaken).catch(oneGuild)

  return rows[0]
}

/**
 * R7. Rascunho expirado não gera auditoria: não houve ator humano nem cobrança.
 * Filtra por status também: um rascunho banido pelo mod não pode sumir, senão o
 * nome volta a ficar livre (R13).
 */
export async function reapExpiredDrafts () {
  const { rowCount } = await query(
    `DELETE FROM guild
      WHERE status = 'awaiting' AND payment_status = 'awaiting' AND reserved_until < now()`)
  return rowCount
}

/**
 * R11: estorno/chargeback achado na reconciliação. A guilda não é apagada —
 * membros e histórico ficam, e o mod reativa à mão se julgar erro.
 * Sem rota: quem chama é o job diário que lê o relatório de transações da Twitch
 * (doc §8, risco 1), que ainda não existe.
 */
export async function markRefunded (channelId, transactionId) {
  return tx(async (c) => {
    const { rows: [g] } = await c.query(
      `SELECT * FROM guild WHERE channel_id = $1 AND bits_transaction_id = $2 FOR UPDATE`,
      [channelId, transactionId])
    if (!g || g.payment_status === 'refunded') return null

    await c.query(
      `UPDATE guild SET payment_status = 'refunded', status = 'suspended' WHERE id = $1`, [g.id])
    await emit(c, {
      channelId,
      guildId: g.id,
      type: 'guild.moderated',
      payload: { action: 'guild.refund_suspend', actor_user_id: 'system' },
      actorUserId: 'system',
    })
    await audit(c, {
      channelId,
      actorUserId: 'system',
      actorRole: 'system',
      action: 'guild.refund_suspend',
      target: `guild:${g.id}`,
      before: { payment_status: g.payment_status, status: g.status },
      after: { payment_status: 'refunded', status: 'suspended' },
    })
    return g.id
  })
}

export default async function guilds (app) {
  app.post('/guilds', async (req, reply) => {
    const userId = requireUser(req)
    const body = req.body ?? {}

    const guild = await tx(async (c) => {
      const channel = await getChannel(c, req.auth)
      if (!channel.settings.creation_enabled) {
        throw forbidden('CREATION_DISABLED', 'criação de guildas desativada neste canal')
      }

      // Busca se já existe um rascunho "awaiting" para este usuário
      const { rows: [existing] } = await c.query(
        `SELECT * FROM guild
          WHERE channel_id = $1 AND leader_user_id = $2
            AND status = 'awaiting' AND payment_status = 'awaiting'`,
        [channel.id, userId]
      )

      if (existing) {
        // Se o rascunho ainda for válido, retorna ele.
        if (new Date(existing.reserved_until) > new Date()) {
          return { row: existing, channel }
        }
        // Se estiver expirado, removemos para permitir a criação de um novo
        // (Isso evita o erro 409 Conflict causado por rascunhos velhos)
        await c.query('DELETE FROM guild WHERE id = $1', [existing.id])
      }

      rateLimit(userId)
      // name/tag sempre presentes na chave para o parseForm cobrar os dois.
      const form = parseForm({ name: body.name, tag: body.tag, ...body }, channel.settings)
      return { row: await insertDraft(c, channel, userId, form), channel }
    })

    return reply.code(201).send({
      id: guild.row.id,
      sku: guild.channel.settings.creation_sku,
      bits_cost: guild.channel.settings.creation_bits_cost,
      reserved_until: guild.row.reserved_until,
    })
  })

  // `!criarguilda <Nome>`: só reserva o nome. O bot afirma quem falou e o EBS
  // acredita (ARQUITETURA); pagar continua exigindo o painel, com JWT.
  app.post('/chat/guild-drafts', async (req, reply) => {
    if (req.auth.source !== 'bot') throw forbidden('FORBIDDEN', 'rota exclusiva do bot do canal')
    const userId = String(req.body?.user_id ?? '')
    if (!userId) throw badRequest('VALIDATION_ERROR', 'user_id obrigatório')

    const out = await tx(async (c) => {
      const channel = await getChannel(c, req.auth)
      if (!channel.settings.creation_enabled) {
        throw forbidden('CREATION_DISABLED', 'criação de guildas desativada neste canal')
      }
      rateLimit(userId)
      const form = parseForm({ name: req.body?.name }, channel.settings)
      const row = await insertDraft(c, channel, userId, form)
      return { guild_id: row.id, panel_url: channel.settings.panel_url }
    })

    return reply.code(201).send(out)
  })

  // Criador completa o rascunho, ou corrige o que a moderação apontou (R12).
  app.patch('/guilds/:id', async (req) => tx(async (c) => {
    const userId = requireUser(req)
    const channel = await getChannel(c, req.auth)
    const g = await loadGuild(c, channel.id, req.params.id, true)

    if (g.creator_user_id !== userId) throw forbidden('FORBIDDEN', 'só o criador edita o formulário')
    const editable = g.payment_status === 'awaiting' || (g.status === 'suspended' && g.reject_reason)
    if (!editable) throw conflict('GUILD_NOT_EDITABLE', 'guilda não está em edição')

    const form = parseForm(req.body ?? {}, channel.settings)
    if (!Object.keys(form).length) throw badRequest('VALIDATION_ERROR', 'nada para alterar')

    const cols = Object.keys(form)                    // chaves vêm do parseForm, não do cliente
    const sets = cols.map((k, i) => `${k} = $${i + 2}`).join(', ')
    const { rows } = await c.query(
      `UPDATE guild SET ${sets} WHERE id = $1 RETURNING *`,
      [g.id, ...cols.map((k) => form[k])])
      .catch(nameTaken).catch(tagTaken)

    return view(rows[0], true)
  }))

  app.post('/guilds/:id/transaction', async (req) => {
    const userId = requireUser(req)
    if (req.auth.source !== 'extension') throw forbidden('FORBIDDEN', 'pagamento exige o painel')

    // Aceita tanto 'receipt' quanto 'transaction_receipt' (enviado pelo frontend)
    const rawReceipt = req.body?.transaction_receipt || req.body?.receipt
    const receipt = decodeReceipt(rawReceipt)
    const channel = await getChannel(pool, req.auth)
    checkReceipt(receipt, {
      sku: channel.settings.creation_sku,
      cost: channel.settings.creation_bits_cost,
      twitchChannelId: req.auth.channelId,
    })

    const out = await tx(async (c) => {
      const { rows } = await c.query(
        'SELECT * FROM guild WHERE id = $1 AND channel_id = $2 FOR UPDATE',
        [Number(req.params.id) || 0, channel.id])
      const g = rows[0]

      // Pagou depois do reaper levar o rascunho (R7, §8 risco 2): o recibo fica
      // registrado como evento órfão para o mod reconciliar à mão.
      if (!g || (g.payment_status === 'awaiting' && new Date(g.reserved_until) <= new Date())) {
        await emit(c, {
          channelId: channel.id,
          type: 'guild.created',
          payload: { orphan: true, name: g?.name ?? null, tag: g?.tag ?? null, leader_user_id: userId },
          actorUserId: userId,
          externalId: receipt.transactionId,
        })
        return { expired: true }
      }

      if (g.creator_user_id !== userId) throw forbidden('FORBIDDEN', 'só o criador confirma o pagamento')

      if (g.payment_status !== 'awaiting') {
        if (g.bits_transaction_id !== receipt.transactionId) {
          throw conflict('PAYMENT_ALREADY_USED', 'guilda já paga com outra transação')
        }
        return { id: g.id, status: g.status }      // reenvio do mesmo recibo (R9)
      }
      if (!g.tag) throw badRequest('VALIDATION_ERROR', 'defina a TAG antes de pagar')

      const ev = await emit(c, {
        channelId: channel.id,
        guildId: g.id,
        type: 'guild.created',
        payload: { name: g.name, tag: g.tag, leader_user_id: g.leader_user_id },
        actorUserId: userId,
        externalId: receipt.transactionId,
      })

      if (!ev) {
        const { rows: [prev] } = await c.query(
          `SELECT guild_id FROM guild_event
            WHERE channel_id = $1 AND type = 'guild.created' AND external_id = $2`,
          [channel.id, receipt.transactionId])
        if (Number(prev?.guild_id) !== Number(g.id)) {
          throw conflict('PAYMENT_ALREADY_USED', 'recibo já usado por outra guilda')
        }
        return { id: g.id, status: g.status }
      }

      await c.query(
        `UPDATE guild SET status = 'pending', payment_status = 'paid',
                          bits_transaction_id = $2, bits_amount = $3, reserved_until = NULL
          WHERE id = $1`,
        [g.id, receipt.transactionId, receipt.amount])
        .catch(onUnique('guild_bits_tx_uk', 'PAYMENT_ALREADY_USED', 'recibo já usado por outra guilda'))

      // R18: a linha do líder nasce aqui, na mesma transação do pagamento.
      await c.query(
        `INSERT INTO guild_member (guild_id, user_id, channel_id, role)
         VALUES ($1, $2, $3, 'lider')`,
        [g.id, g.leader_user_id, channel.id])
        .catch(onUnique('guild_member_one_per_channel_uk', 'ALREADY_HAS_GUILD', 'o líder já está em outra guilda'))

      return { id: g.id, status: 'pending' }
    })

    if (out.expired) {
      throw new AppError(410, 'RESERVATION_EXPIRED',
        'reserva expirada; o recibo foi registrado para reconciliação manual')
    }
    return out
  })

  // R12: reenviar para a fila depois de corrigir. Não cobra Bits de novo.
  app.post('/guilds/:id/resubmit', async (req) => tx(async (c) => {
    const userId = requireUser(req)
    const channel = await getChannel(c, req.auth)
    const g = await loadGuild(c, channel.id, req.params.id, true)

    if (g.leader_user_id !== userId) throw forbidden('FORBIDDEN', 'só o líder reenvia')
    if (!g.reject_reason) throw conflict('GUILD_NOT_REJECTED', 'guilda não foi rejeitada')

    const to = nextStatus('resubmit', g.status)
    await c.query('UPDATE guild SET status = $2, reject_reason = NULL WHERE id = $1', [g.id, to])
    return { status: to }
  }))

  // R19: só guildas ativas são públicas.
  app.get('/guilds', async (req) => {
    const channel = await getChannel(pool, req.auth)
    const limit = pageLimit(req.query.limit)

    // Blindagem extra: garantimos que apenas status 'active' e 'overflow' (guilda cheia)
    // apareçam na listagem pública. 'pending' e 'awaiting' ficam invisíveis.
    const { rows } = await query(
      `SELECT * FROM guild
        WHERE channel_id = $1 AND status = ANY($2::guild_status[])
          AND ($3::bigint IS NULL OR id > $3)
        ORDER BY id LIMIT $4`,
      [channel.id, ['active', 'overflow'], req.query.cursor || null, limit])

    return {
      items: rows.map((g) => view(g)),
      next_cursor: rows.length === limit ? rows[rows.length - 1].id : null,
    }
  })

  app.get('/guilds/:id', async (req) => {
    const channel = await getChannel(pool, req.auth)
    const g = await loadGuild(pool, channel.id, req.params.id)
    const own = req.auth.userId && (g.leader_user_id === req.auth.userId || g.creator_user_id === req.auth.userId)
    const privileged = isMod(req) || own
    if (g.status !== 'active' && !privileged) throw new AppError(404, 'GUILD_NOT_FOUND', 'guilda não encontrada')
    return view(g, Boolean(privileged))
  })

  await app.register(modRoutes)

  // O reaper (§3.2) é agendado em core/jobs.js. Aqui fica só a GC do balde de
  // rate limit, que é estado em memória deste módulo.
  const timer = setInterval(() => {
    const cutoff = Date.now() - DAY
    for (const [k, hits] of buckets) if (hits.every((t) => t < cutoff)) buckets.delete(k)
  }, 60_000)
  timer.unref()
  app.addHook('onClose', () => clearInterval(timer))
}
