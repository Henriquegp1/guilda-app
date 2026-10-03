import { randomUUID } from 'node:crypto'
import { requireBroadcaster, requireModerator } from '../../core/auth.js'
import { pool, query, tx } from '../../core/db.js'
import { audit, emit } from '../../core/events.js'
import { AppError, badRequest, onUnique } from '../../core/errors.js'
import { getChannel, loadGuild, pageLimit, view } from './queries.js'
import { nextStatus } from './status.js'
import { parseForm } from './validate.js'

const nameTaken = onUnique('guild_name_uk', 'GUILD_NAME_TAKEN', 'nome já usado neste canal')
const tagTaken = onUnique('guild_tag_uk', 'GUILD_TAG_TAKEN', 'TAG já usada neste canal')
const oneGuild = onUnique('guild_one_per_leader_uk', 'ALREADY_HAS_GUILD', 'esse usuário já lidera uma guilda neste canal')

const STATUSES = ['awaiting', 'pending', 'active', 'overflow', 'suspended', 'banned', 'purged']

/** R20: mutação de mod e audit_log na mesma transação — auditoria falhou, nada mudou. */
function withGuild (req, fn) {
  requireModerator(req)
  return tx(async (c) => {
    const channel = await getChannel(c, req.auth)
    const g = await loadGuild(c, channel.id, req.params.id, true)
    return fn(c, channel, g, req.auth)
  })
}

/** approve/reject/suspend/unsuspend/ban só diferem no que gravam junto do status. */
async function moveStatus (c, channel, g, auth, { action, auditAction, set = {}, before = {}, after = {}, eventType }) {
  const to = nextStatus(action, g.status)
  const cols = Object.keys(set)
  const sets = ['status = $2', ...cols.map((k, i) => `${k} = $${i + 3}`)].join(', ')
  await c.query(`UPDATE guild SET ${sets} WHERE id = $1`, [g.id, to, ...cols.map((k) => set[k])])

  await emit(c, {
    channelId: channel.id,
    guildId: g.id,
    type: eventType,
    payload: eventType === 'guild.moderated'
      ? { action: auditAction, actor_user_id: auth.userId }
      // bits_amount viaja no payload: a fase 06 calcula o crédito de rejeição a
      // partir dele e não deve ler coluna de outro módulo (docs/EVENTOS.md).
      : { actor_user_id: auth.userId, ...after, ...(eventType === 'guild.rejected' ? { bits_amount: g.bits_amount } : {}) },
    actorUserId: auth.userId,
  })
  await audit(c, {
    channelId: channel.id,
    actorUserId: auth.userId,
    actorRole: auth.role,
    action: auditAction,
    target: `guild:${g.id}`,
    before: { status: g.status, ...before },
    after: { status: to, ...after },
  })
  return { status: to }
}

const AUDIT_ACTION = {
  name: () => 'guild.rename',
  description: () => 'guild.edit_description',
  emblem_preset: (v) => (v == null ? 'guild.remove_emblem' : 'guild.change_emblem'),
}

export default async function modRoutes (app) {
  app.get('/mod/guilds', async (req) => {
    requireModerator(req)
    const channel = await getChannel(pool, req.auth)
    const status = req.query.status ?? 'pending'
    if (!STATUSES.includes(status)) throw badRequest('VALIDATION_ERROR', 'status inválido')
    const limit = pageLimit(req.query.limit)

    // A fila só mostra guilda paga: rascunho não moderado não existe para o mod (R10).
    const filter = `channel_id = $1 AND status = $2::guild_status
                    AND ($2 <> 'pending' OR payment_status = 'paid')`
    const [{ rows }, { rows: [count] }] = await Promise.all([
      query(`SELECT * FROM guild WHERE ${filter} AND ($3::bigint IS NULL OR id > $3)
              ORDER BY id LIMIT $4`, [channel.id, status, req.query.cursor || null, limit]),
      query(`SELECT count(*)::int AS total FROM guild WHERE ${filter}`, [channel.id, status]),
    ])

    return {
      items: rows.map((g) => view(g, true)),
      total: count.total,
      next_cursor: rows.length === limit ? rows[rows.length - 1].id : null,
    }
  })

  // Criação gratuita (sem Bits), só o streamer. A guilda já nasce `active`: quem
  // cria é a própria moderação, então não há fila a aprovar. Para satisfazer
  // guild_paid_has_tx_chk, a "transação" é um id sintético `free:<uuid>` e
  // bits_amount = 0 — assim a fase 06 nunca gera crédito de rejeição e a
  // reconciliação de estornos (markRefunded) nunca casa com ela.
  app.post('/mod/guilds', async (req, reply) => {
    requireBroadcaster(req)
    const { name, tag, leader_user_id: leaderRaw, reason } = req.body ?? {}
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 280) {
      throw badRequest('VALIDATION_ERROR', 'reason: 1–280 caracteres (obrigatório)')
    }
    const leaderId = String(leaderRaw ?? '').trim()
    if (!/^\d{1,20}$/.test(leaderId)) {
      throw badRequest('VALIDATION_ERROR', 'leader_user_id: informe o ID numérico da Twitch do líder')
    }

    const guild = await tx(async (c) => {
      const channel = await getChannel(c, req.auth)
      const form = parseForm({ name, tag }, channel.settings)
      const txId = `free:${randomUUID()}`

      const { rows: [g] } = await c.query(
        `INSERT INTO guild (channel_id, name, tag, creator_user_id, leader_user_id,
                            status, payment_status, bits_transaction_id, bits_amount,
                            member_count, member_limit, reviewed_by_user_id, reviewed_at)
         VALUES ($1, $2, $3, $4, $4, 'active', 'paid', $5, 0, 1, $6, $7, now())
         RETURNING *`,
        [channel.id, form.name, form.tag, leaderId, txId,
          channel.settings.default_member_limit, req.auth.userId])
        .catch(nameTaken).catch(tagTaken).catch(oneGuild)

      // Mesma regra do fluxo pago (R18): o líder nasce junto com a guilda.
      await c.query(
        `INSERT INTO guild_member (guild_id, user_id, channel_id, role) VALUES ($1, $2, $3, 'lider')`,
        [g.id, leaderId, channel.id])
        .catch(onUnique('guild_member_one_per_channel_uk', 'ALREADY_HAS_GUILD', 'esse usuário já está em outra guilda neste canal'))

      await emit(c, {
        channelId: channel.id,
        guildId: g.id,
        type: 'guild.created',
        payload: { name: g.name, tag: g.tag, leader_user_id: leaderId, free: true },
        actorUserId: req.auth.userId,
        externalId: txId,
      })
      await emit(c, {
        channelId: channel.id,
        guildId: g.id,
        type: 'guild.approved',
        payload: { actor_user_id: req.auth.userId },
        actorUserId: req.auth.userId,
      })
      await audit(c, {
        channelId: channel.id,
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        action: 'guild.create_free',
        target: `guild:${g.id}`,
        before: null,
        after: { name: g.name, tag: g.tag, leader_user_id: leaderId, reason },
      })
      return g
    })

    return reply.code(201).send(view(guild, true))
  })

  app.get('/mod/guilds/:id/members', async (req) => withGuild(req, async (c, _channel, guild) => {
    const { rows } = await c.query(
      `SELECT m.user_id, m.role, m.joined_at,
              COALESCE(p.nickname, m.user_id) AS nickname
         FROM guild_member m
         LEFT JOIN user_profile p
           ON p.channel_id = m.channel_id
          AND p.user_id = m.user_id
          AND p.status = 'approved'
        WHERE m.guild_id = $1
        ORDER BY m.joined_at, m.user_id`,
      [guild.id])
    return { members: rows }
  }))

  app.delete('/mod/guilds/:id', async (req, reply) => {
    requireBroadcaster(req)
    return withGuild(req, async (c, channel, guild, auth) => {
      const { rows: members } = await c.query(
        'SELECT user_id, role FROM guild_member WHERE guild_id = $1 ORDER BY joined_at, user_id',
        [guild.id])

      await audit(c, {
        channelId: channel.id,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'guild.deleted',
        target: `guild:${guild.id}`,
        before: { status: guild.status, name: guild.name, tag: guild.tag, members },
        after: null,
      })
      await c.query('DELETE FROM guild WHERE id = $1 AND channel_id = $2', [guild.id, channel.id])
      reply.code(204)
    })
  })

  app.post('/mod/guilds/:id/approve', async (req) => withGuild(req, (c, channel, g, auth) => {
    if (g.payment_status !== 'paid') {
      throw new AppError(409, 'GUILD_NOT_PENDING', 'guilda sem pagamento confirmado')
    }
    return moveStatus(c, channel, g, auth, {
      action: 'approve',
      auditAction: 'guild.approve',
      eventType: 'guild.approved',
      set: { reviewed_by_user_id: auth.userId, reviewed_at: new Date(), reject_reason: null },
    })
  }))

  app.post('/mod/guilds/:id/reject', async (req) => withGuild(req, (c, channel, g, auth) => {
    const reason = req.body?.reason
    const fields = req.body?.fields ?? []
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 280) {
      throw badRequest('VALIDATION_ERROR', 'reason: 1–280 caracteres (obrigatório)')
    }
    if (!Array.isArray(fields) || fields.some((f) => !['name', 'description', 'emblem'].includes(f))) {
      throw badRequest('VALIDATION_ERROR', 'fields: name | description | emblem')
    }
    return moveStatus(c, channel, g, auth, {
      action: 'reject',
      auditAction: 'guild.reject',
      eventType: 'guild.rejected',
      set: { reject_reason: reason, reviewed_by_user_id: auth.userId, reviewed_at: new Date() },
      before: { reject_reason: g.reject_reason },
      after: { reject_reason: reason, fields },
    })
  }))

  app.post('/mod/guilds/:id/suspend', async (req) => withGuild(req, (c, channel, g, auth) => {
    const reason = req.body?.reason
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 280) {
      throw badRequest('VALIDATION_ERROR', 'reason: 1–280 caracteres (obrigatório)')
    }
    return moveStatus(c, channel, g, auth, {
      action: 'suspend',
      auditAction: 'guild.suspend',
      eventType: 'guild.moderated',
      after: { reason },
    })
  }))

  app.post('/mod/guilds/:id/unsuspend', async (req) => withGuild(req, (c, channel, g, auth) =>
    moveStatus(c, channel, g, auth, {
      action: 'unsuspend',
      auditAction: 'guild.unsuspend',
      eventType: 'guild.moderated',
      set: { reject_reason: null },
    })))

  // R13: guild_member fica intacto e nome/TAG seguem bloqueados pelo índice do core.
  app.post('/mod/guilds/:id/ban', async (req) => {
    requireBroadcaster(req)
    const reason = req.body?.reason
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 280) {
      throw badRequest('VALIDATION_ERROR', 'reason: 1–280 caracteres (obrigatório)')
    }
    return withGuild(req, (c, channel, g, auth) =>
      moveStatus(c, channel, g, auth, {
        action: 'ban',
        auditAction: 'guild.ban',
        eventType: 'guild.moderated',
        after: { reason },
      }))
  })

  app.patch('/mod/guilds/:id', async (req) => withGuild(req, async (c, channel, g, auth) => {
    const body = req.body ?? {}
    const actor = auth.userId
    const editable = ['name', 'description', 'emblem_preset']
    const form = parseForm(
      Object.fromEntries(Object.entries(body).filter(([k]) => editable.includes(k))),
      channel.settings)
    if (!Object.keys(form).length) throw badRequest('VALIDATION_ERROR', 'nada para alterar')

    const cols = Object.keys(form)                    // chaves vêm do parseForm, não do cliente
    const sets = cols.map((k, i) => `${k} = $${i + 2}`).join(', ')
    const { rows } = await c.query(
      `UPDATE guild SET ${sets} WHERE id = $1 RETURNING *`, [g.id, ...cols.map((k) => form[k])])
      .catch(onUnique('guild_name_uk', 'GUILD_NAME_TAKEN', 'nome já usado neste canal'))

    // Uma linha de auditoria por campo: o painel reverte campo a campo.
    for (const k of cols) {
      const action = AUDIT_ACTION[k](form[k])
      await audit(c, {
        channelId: channel.id,
        actorUserId: actor,
        action,
        target: `guild:${g.id}`,
        before: { [k]: g[k] },
        after: { [k]: form[k] },
      })
      await emit(c, {
        channelId: channel.id,
        guildId: g.id,
        type: 'guild.moderated',
        payload: { action, actor_user_id: actor },
        actorUserId: actor,
      })
    }
    return view(rows[0], true)
  }))

  // R18: o alvo já precisa ser membro; os dois trocam de cargo.
  app.post('/mod/guilds/:id/transfer-leader', async (req) => {
    requireBroadcaster(req)
    const reason = req.body?.reason
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 280) {
      throw badRequest('VALIDATION_ERROR', 'reason: 1–280 caracteres (obrigatório)')
    }
    return withGuild(req, async (c, channel, g, auth) => {
      const target = String(req.body?.user_id ?? '')
      if (!target) throw badRequest('VALIDATION_ERROR', 'user_id obrigatório')
      if (target === g.leader_user_id) return { leader_user_id: target }

      const { rows: [member] } = await c.query(
        'SELECT role FROM guild_member WHERE guild_id = $1 AND user_id = $2', [g.id, target])
      if (!member) throw new AppError(422, 'USER_NOT_MEMBER', 'alvo não é membro da guilda')

      // Rebaixa antes de promover: guild_member_leader_uk não tolera dois líderes.
      await c.query('UPDATE guild_member SET role = $3 WHERE guild_id = $1 AND user_id = $2',
        [g.id, g.leader_user_id, member.role])
      await c.query(`UPDATE guild_member SET role = 'lider' WHERE guild_id = $1 AND user_id = $2`,
        [g.id, target])
      await c.query('UPDATE guild SET leader_user_id = $2 WHERE id = $1', [g.id, target])
        .catch(onUnique('guild_one_per_leader_uk', 'ALREADY_HAS_GUILD', 'o alvo já lidera outra guilda neste canal'))

      await emit(c, {
        channelId: channel.id,
        guildId: g.id,
        type: 'guild.moderated',
        payload: { action: 'guild.transfer_leader', actor_user_id: auth.userId, reason },
        actorUserId: auth.userId,
      })
      await audit(c, {
        channelId: channel.id,
        actorUserId: auth.userId,
        actorRole: auth.role,
        action: 'guild.transfer_leader',
        target: `guild:${g.id}`,
        before: { leader_user_id: g.leader_user_id },
        after: { leader_user_id: target, reason },
      })
      return { leader_user_id: target }
    })
  })

  app.get('/mod/audit-log', async (req) => {
    requireModerator(req)
    const channel = await getChannel(pool, req.auth)
    const limit = pageLimit(req.query.limit)
    const { rows } = await query(
      `SELECT * FROM audit_log
        WHERE channel_id = $1
          AND ($2::text IS NULL OR target = $2)
          AND ($3::text IS NULL OR actor_user_id = $3)
          AND ($4::bigint IS NULL OR id < $4)
        ORDER BY id DESC LIMIT $5`,
      [channel.id, req.query.target || null, req.query.actor || null, req.query.cursor || null, limit])

    return { items: rows, next_cursor: rows.length === limit ? rows[rows.length - 1].id : null }
  })
}
