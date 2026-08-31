import { tx } from '../../core/db.js'
import { emit, audit } from '../../core/events.js'
import { AppError, badRequest, conflict, forbidden, notFound, onUnique } from '../../core/errors.js'
import { requireModerator } from '../../core/auth.js'
import { denyReason, roleChangeError, rank } from './permissions.js'
import { COOLDOWN_H } from './cooldown.js'
import {
  addMember, assertJoinable, assertNoCooldown, channelPk, err, getGuild, lockGuild,
  membershipOf, memberIn, newInviteCode, num, removeMember, requireUser, transferLeadership,
} from './queries.js'

const REQUEST_TTL = "interval '7 days'"     // R11
const INVITE_TTL = "interval '72 hours'"    // R14

/** Broadcaster/mod atua por cima de qualquer guilda (matriz §4) e nunca via bot. */
const isMod = (req) => { try { requireModerator(req); return true } catch { return false } }

/** Cargo efetivo do ator dentro da guilda. Mod do canal joga como líder. */
async function actorRole (client, req, guild) {
  const member = req.auth.userId ? await memberIn(client, guild.id, req.auth.userId) : null
  if (isMod(req)) return { role: 'leader', member, mod: !member || member.role !== 'leader' }
  if (!member) throw forbidden('FORBIDDEN_ROLE', 'não é membro desta guilda')
  return { role: member.role, member, mod: false }
}

function assertCan (role, action, targetRole = null) {
  const code = denyReason(role, action, targetRole)
  if (!code) return
  throw new AppError(code === 'TARGET_NOT_MEMBER' ? 404 : 403, code, `ação negada: ${action}`)
}

const page = (q) => Math.min(Math.max(Number(q.limit) || 25, 1), 100)

export default async function members (app) {
  // ---------------------------------------------------------------- listagem
  app.get('/guilds/:gid/members', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    await getGuild(c, cid, req.params.gid)
    const limit = page(req.query)
    const cursor = Number.isNaN(Date.parse(req.query.cursor)) ? null : new Date(req.query.cursor)
    const { rows } = await c.query(
      `SELECT user_id, role, joined_at FROM guild_member
        WHERE guild_id = $1 AND ($2::timestamptz IS NULL OR joined_at > $2)
        ORDER BY joined_at, user_id LIMIT $3`,
      [num(req.params.gid), cursor, limit])
    return {
      members: rows,
      next_cursor: rows.length === limit ? rows.at(-1).joined_at.toISOString() : null,
    }
  }))

  // ---------------------------------------------------------------- entrar
  app.post('/guilds/:gid/join', async (req, reply) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const userId = requireUser(req.auth)
    const guild = await lockGuild(c, cid, req.params.gid)

    if (guild.status !== 'active') throw conflict('GUILD_NOT_ACTIVE', 'guilda não está ativa')
    // R15: guilda fechada não cria pedido, só recusa.
    if (guild.join_mode === 'closed') throw forbidden('GUILD_CLOSED', 'guilda só entra por convite')

    if (guild.join_mode === 'open') {
      await assertJoinable(c, guild, userId)
      await addMember(c, guild, userId, { via: 'open' })
      reply.code(201)
      return { status: 'joined', role: 'recruit' }
    }

    // approval: pedido entra na fila mesmo com a guilda cheia (R4).
    if (await membershipOf(c, cid, userId)) throw conflict('ALREADY_IN_GUILD', 'já pertence a uma guilda')
    await assertNoCooldown(c, cid, userId, guild.id)

    const { rows: [recusa] } = await c.query(
      `SELECT decided_at FROM guild_join_request
        WHERE guild_id = $1 AND user_id = $2 AND status = 'rejected'
          AND decided_at > now() - interval '${COOLDOWN_H.rejected} hours' LIMIT 1`,
      [guild.id, userId])
    if (recusa) throw err(429, 'JOIN_COOLDOWN', 'pedido recusado há menos de 24h')

    // R13: 3 pendentes por canal, 5 pedidos por hora.
    const { rows: [uso] } = await c.query(
      `SELECT count(*) FILTER (WHERE status = 'pending')                  AS pendentes,
              count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS na_hora
         FROM guild_join_request WHERE channel_id = $1 AND user_id = $2`, [cid, userId])
    if (Number(uso.pendentes) >= 3 || Number(uso.na_hora) >= 5) {
      throw err(429, 'RATE_LIMITED', 'muitos pedidos de entrada')
    }

    const { rows: [reqRow] } = await c.query(
      `INSERT INTO guild_join_request (channel_id, guild_id, user_id, message, expires_at)
       VALUES ($1, $2, $3, $4, now() + ${REQUEST_TTL}) RETURNING id, expires_at`,
      [cid, guild.id, userId, req.body?.message ?? null])
      .catch(onUnique('gjr_one_pending_per_guild_uk', 'REQUEST_ALREADY_PENDING', 'já existe pedido pendente'))

    await emit(c, {
      channelId: cid,
      guildId: guild.id,
      type: 'join.requested',
      payload: { request_id: reqRow.id, user_id: userId },
      actorUserId: userId,
    })
    reply.code(202)
    return { status: 'pending', request_id: reqRow.id }
  }))

  // ---------------------------------------------------------------- sair
  app.delete('/guilds/:gid/members/me', async (req, reply) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const userId = requireUser(req.auth)
    const guild = await lockGuild(c, cid, req.params.gid)
    const member = await memberIn(c, guild.id, userId)
    if (!member) throw notFound('NOT_A_MEMBER', 'não é membro desta guilda')

    // R17/R18: líder só sai se for o último. Senão, transfere antes.
    if (member.role === 'leader' && guild.member_count > 1) {
      throw conflict('LEADER_MUST_TRANSFER', 'transfira a liderança antes de sair')
    }
    await removeMember(c, guild, member, { reason: 'left' })
    reply.code(204)
  }))

  // ---------------------------------------------------------------- fila de pedidos
  app.get('/guilds/:gid/requests', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const guild = await getGuild(c, cid, req.params.gid)
    const { role } = await actorRole(c, req, guild)
    assertCan(role, 'requests_view')

    const limit = page(req.query)
    const { rows } = await c.query(
      `SELECT id, user_id, message, created_at, expires_at FROM guild_join_request
        WHERE guild_id = $1 AND status = $2 AND ($3::bigint IS NULL OR id > $3)
        ORDER BY id LIMIT $4`,
      [guild.id, req.query.status ?? 'pending', req.query.cursor ? num(req.query.cursor) : null, limit])
    return { requests: rows, next_cursor: rows.length === limit ? String(rows.at(-1).id) : null }
  }))

  app.post('/guilds/:gid/requests/:rid/approve', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const actorId = requireUser(req.auth)
    const guild = await lockGuild(c, cid, req.params.gid)
    const { role, mod } = await actorRole(c, req, guild)
    assertCan(role, 'request_approve')

    const pedido = await pendingRequest(c, guild.id, req.params.rid)
    await assertJoinable(c, guild, pedido.user_id)   // revalida vagas e cooldown (R3, R12)

    await decide(c, pedido.id, 'approved', actorId)
    await addMember(c, guild, pedido.user_id, { via: 'request', actorUserId: actorId })
    await emit(c, {
      channelId: cid,
      guildId: guild.id,
      type: 'join.approved',
      payload: { request_id: pedido.id, user_id: pedido.user_id, actor_user_id: actorId },
      actorUserId: actorId,
    })
    if (mod) {
      await audit(c, {
        channelId: cid, actorUserId: actorId, action: 'members.request_approve',
        target: `guild:${guild.id}/user:${pedido.user_id}`, after: { role: 'recruit' },
      })
    }
    return { status: 'approved' }
  }))

  app.post('/guilds/:gid/requests/:rid/reject', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const actorId = requireUser(req.auth)
    const guild = await getGuild(c, cid, req.params.gid)
    const { role } = await actorRole(c, req, guild)
    assertCan(role, 'request_reject')

    const pedido = await pendingRequest(c, guild.id, req.params.rid)
    await decide(c, pedido.id, 'rejected', actorId)
    await emit(c, {
      channelId: cid,
      guildId: guild.id,
      type: 'join.rejected',
      payload: { request_id: pedido.id, user_id: pedido.user_id, actor_user_id: actorId },
      actorUserId: actorId,
    })
    return { status: 'rejected' }
  }))

  app.delete('/guilds/:gid/requests/mine', async (req, reply) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const userId = requireUser(req.auth)
    const { rowCount } = await c.query(
      `UPDATE guild_join_request SET status = 'cancelled', decided_at = now()
        WHERE guild_id = $1 AND channel_id = $2 AND user_id = $3 AND status = 'pending'`,
      [num(req.params.gid), cid, userId])
    if (!rowCount) throw notFound('REQUEST_NOT_FOUND', 'sem pedido pendente')
    reply.code(204)
  }))

  // ---------------------------------------------------------------- convites
  app.post('/guilds/:gid/invites', async (req, reply) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const actorId = requireUser(req.auth)
    const guild = await lockGuild(c, cid, req.params.gid)
    const { role } = await actorRole(c, req, guild)
    assertCan(role, 'invite_create')

    const alvo = String(req.body?.invitee_user_id ?? '')
    if (!alvo) throw badRequest('INVALID_INVITEE', 'invitee_user_id obrigatório')
    if (alvo === actorId) throw badRequest('INVALID_INVITEE', 'não dá para se auto-convidar')
    if (guild.status !== 'active') throw conflict('GUILD_NOT_ACTIVE', 'guilda não está ativa')
    // R5: convite é promessa de vaga; guilda cheia não emite convite novo.
    if (guild.member_count >= guild.member_limit) throw conflict('GUILD_FULL', 'guilda cheia')
    if (await membershipOf(c, cid, alvo)) throw conflict('TARGET_ALREADY_IN_GUILD', 'alvo já tem guilda')

    const { rows: [{ count }] } = await c.query(
      "SELECT count(*) FROM guild_invite WHERE guild_id = $1 AND status = 'pending'", [guild.id])
    if (Number(count) >= 10) throw err(429, 'RATE_LIMITED', 'máximo de 10 convites pendentes')

    const { rows: [inv] } = await c.query(
      `INSERT INTO guild_invite (channel_id, guild_id, invitee_user_id, code, created_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, now() + ${INVITE_TTL}) RETURNING id, code, expires_at`,
      [cid, guild.id, alvo, newInviteCode(), actorId])
      .catch(onUnique('gi_one_pending_per_invitee_uk', 'INVITE_ALREADY_PENDING', 'já há convite pendente'))

    await emit(c, {
      channelId: cid,
      guildId: guild.id,
      type: 'invite.created',
      payload: { invite_id: inv.id, invitee_user_id: alvo, actor_user_id: actorId },
      actorUserId: actorId,
    })
    reply.code(201)
    return { invite_id: inv.id, code: inv.code, expires_at: inv.expires_at }
  }))

  app.get('/guilds/:gid/invites', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const guild = await getGuild(c, cid, req.params.gid)
    const { role } = await actorRole(c, req, guild)
    assertCan(role, 'invite_create')   // mesma linha da matriz: veterano+

    const { rows } = await c.query(
      `SELECT id, invitee_user_id, created_by_user_id, status, expires_at, created_at
         FROM guild_invite WHERE guild_id = $1 AND status = $2 ORDER BY id DESC LIMIT 100`,
      [guild.id, req.query.status ?? 'pending'])
    return { invites: rows }
  }))

  app.delete('/guilds/:gid/invites/:iid', async (req, reply) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const actorId = requireUser(req.auth)
    const guild = await getGuild(c, cid, req.params.gid)
    const { role } = await actorRole(c, req, guild)

    const { rows: [inv] } = await c.query(
      'SELECT * FROM guild_invite WHERE id = $1 AND guild_id = $2 FOR UPDATE',
      [num(req.params.iid), guild.id])
    if (!inv) throw notFound('INVITE_NOT_FOUND', 'convite não encontrado')
    if (inv.status !== 'pending') throw conflict('INVITE_NOT_PENDING', 'convite já respondido')
    assertCan(role, inv.created_by_user_id === actorId ? 'invite_revoke_own' : 'invite_revoke_any')

    await c.query(
      "UPDATE guild_invite SET status = 'revoked', responded_at = now() WHERE id = $1", [inv.id])
    reply.code(204)
  }))

  /**
   * "Em qual guilda eu estou?" — a primeira pergunta que o painel faz e a única
   * que não tinha resposta: `GET /guilds` lista as ativas do canal, não a minha.
   *
   * Devolve `null` em vez de 404 porque não ter guilda é o estado normal de
   * quase todo viewer, não uma falha.
   */
  app.get('/me/guild', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    // Sem identidade concedida não dá para saber quem é: responde "sem guilda"
    // em vez de exigir o compartilhamento logo na abertura do painel.
    if (!req.auth.userId) return null

    const { rows } = await c.query(
      `SELECT g.*, m.role, m.joined_at, e.custom_local_path
         FROM guild_member m JOIN guild g ON g.id = m.guild_id
         LEFT JOIN guild_emblem e ON e.guild_id = g.id AND e.is_active = true
        WHERE m.channel_id = $1 AND m.user_id = $2`, [cid, req.auth.userId])
    if (!rows[0]) return null

    const { role, joined_at: joinedAt, custom_local_path: customLocal, ...g } = rows[0]
    const customUrl = customLocal ? `${process.env.BASE_URL ?? 'http://localhost:3000'}/public/custom-assets/${customLocal}` : null
    return { ...g, my_role: role, joined_at: joinedAt, custom_emblem_url: customUrl }
  }))

  app.get('/me/invites', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const userId = requireUser(req.auth)
    const { rows } = await c.query(
      `SELECT i.id AS invite_id, i.code, i.expires_at, g.tag, g.name
         FROM guild_invite i JOIN guild g ON g.id = i.guild_id
        WHERE i.channel_id = $1 AND i.invitee_user_id = $2
          AND i.status = 'pending' AND i.expires_at > now()
        ORDER BY i.id DESC`, [cid, userId])
    return {
      invites: rows.map(r => ({
        invite_id: r.invite_id, code: r.code, expires_at: r.expires_at,
        guild: { tag: r.tag, name: r.name },
      })),
    }
  }))

  app.post('/invites/:code/accept', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const userId = requireUser(req.auth)
    const inv = await lockInvite(c, cid, req.params.code, userId)
    if (new Date(inv.expires_at) <= new Date()) throw conflict('INVITE_EXPIRED', 'convite expirado')

    const guild = await lockGuild(c, cid, inv.guild_id)
    await assertJoinable(c, guild, userId)
    await c.query("UPDATE guild_invite SET status = 'accepted', responded_at = now() WHERE id = $1", [inv.id])
    await addMember(c, guild, userId, { via: 'invite', invitedBy: inv.created_by_user_id })
    await emit(c, {
      channelId: cid,
      guildId: guild.id,
      type: 'invite.accepted',
      payload: { invite_id: inv.id, invitee_user_id: userId, actor_user_id: userId },
      actorUserId: userId,
    })
    return { guild_id: guild.id, role: 'recruit' }
  }))

  app.post('/invites/:code/decline', async (req, reply) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const userId = requireUser(req.auth)
    const inv = await lockInvite(c, cid, req.params.code, userId)
    await c.query("UPDATE guild_invite SET status = 'declined', responded_at = now() WHERE id = $1", [inv.id])
    await emit(c, {
      channelId: cid,
      guildId: inv.guild_id,
      type: 'invite.declined',
      payload: { invite_id: inv.id, invitee_user_id: userId, actor_user_id: userId },
      actorUserId: userId,
    })
    reply.code(204)
  }))

  // ---------------------------------------------------------------- expulsar
  app.delete('/guilds/:gid/members/:uid', async (req, reply) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const actorId = requireUser(req.auth)
    const guild = await lockGuild(c, cid, req.params.gid)
    const { role, mod } = await actorRole(c, req, guild)

    const alvo = await memberIn(c, guild.id, req.params.uid)
    if (!alvo) throw notFound('TARGET_NOT_MEMBER', 'alvo não é membro')
    // R17: o líder não é expulso; o caminho é a transferência de liderança.
    if (alvo.role === 'leader') throw conflict('CANNOT_KICK_LEADER', 'transfira a liderança antes')
    assertCan(role, 'kick', alvo.role)

    await removeMember(c, guild, alvo, { reason: 'kicked', actorUserId: actorId })
    if (mod) {
      await audit(c, {
        channelId: cid, actorUserId: actorId, action: 'members.kick',
        target: `guild:${guild.id}/user:${alvo.user_id}`,
        before: { role: alvo.role }, after: null,
      })
    }
    reply.code(204)
  }))

  // ---------------------------------------------------------------- cargo
  app.patch('/guilds/:gid/members/:uid/role', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const actorId = requireUser(req.auth)
    const guild = await lockGuild(c, cid, req.params.gid)
    const { role, mod } = await actorRole(c, req, guild)

    const alvo = await memberIn(c, guild.id, req.params.uid)
    if (!alvo) throw notFound('TARGET_NOT_MEMBER', 'alvo não é membro')
    const to = String(req.body?.role ?? '')

    const code = roleChangeError(role, alvo.role, to)
    if (code) throw new AppError(403, code, `transição ${alvo.role} -> ${to} negada`)

    await c.query(
      `UPDATE guild_member SET role = $3, role_changed_at = now(), role_changed_by = $4
        WHERE guild_id = $1 AND user_id = $2`, [guild.id, alvo.user_id, to, actorId])
    await emit(c, {
      channelId: cid,
      guildId: guild.id,
      type: rank(to) > rank(alvo.role) ? 'member.promoted' : 'member.demoted',
      payload: { user_id: alvo.user_id, from_role: alvo.role, to_role: to, actor_user_id: actorId },
      actorUserId: actorId,
    })
    if (mod) {
      await audit(c, {
        channelId: cid, actorUserId: actorId, action: 'members.role',
        target: `guild:${guild.id}/user:${alvo.user_id}`,
        before: { role: alvo.role }, after: { role: to },
      })
    }
    return { user_id: alvo.user_id, from_role: alvo.role, to_role: to }
  }))

  // ---------------------------------------------------------------- liderança
  app.post('/guilds/:gid/leadership', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const actorId = requireUser(req.auth)
    const guild = await lockGuild(c, cid, req.params.gid)
    const { role, mod } = await actorRole(c, req, guild)
    assertCan(role, 'leadership_transfer')

    const alvo = await memberIn(c, guild.id, String(req.body?.to_user_id ?? ''))
    if (!alvo) throw notFound('TARGET_NOT_MEMBER', 'alvo não é membro')
    if (alvo.role === 'leader') throw conflict('ALREADY_LEADER', 'alvo já é o líder')

    const { rows: [lider] } = await c.query(
      "SELECT user_id FROM guild_member WHERE guild_id = $1 AND role = 'leader'", [guild.id])
    if (!lider) throw conflict('NO_LEADER', 'guilda sem líder')

    // Mod do canal só entra aqui em sucessão travada (matriz §4, nota 4).
    await transferLeadership(c, guild, lider.user_id, alvo.user_id,
      mod ? 'succession' : 'manual', actorId)
    if (mod) {
      await audit(c, {
        channelId: cid, actorUserId: actorId, action: 'guild.leadership_transferred',
        target: `guild:${guild.id}`,
        before: { leader_user_id: lider.user_id }, after: { leader_user_id: alvo.user_id },
      })
    }
    return { leader_user_id: alvo.user_id }
  }))

  // ---------------------------------------------------------------- settings
  app.patch('/guilds/:gid/settings', async (req) => tx(async (c) => {
    const cid = await channelPk(c, req.auth)
    const actorId = requireUser(req.auth)
    const guild = await lockGuild(c, cid, req.params.gid)
    const { role, mod } = await actorRole(c, req, guild)
    const { join_mode: modo, description, motto } = req.body ?? {}

    if (modo !== undefined) {
      assertCan(role, 'join_mode_change')   // R16: só o líder
      if (!['open', 'approval', 'closed'].includes(modo)) {
        throw badRequest('INVALID_JOIN_MODE', 'modo inválido')
      }
      if (modo !== guild.join_mode) {
        await c.query('UPDATE guild SET join_mode = $2 WHERE id = $1', [guild.id, modo])
        await emit(c, {
          channelId: cid,
          guildId: guild.id,
          type: 'guild.join_mode_changed',
          payload: { from: guild.join_mode, to: modo, actor_user_id: actorId },
          actorUserId: actorId,
        })
        await audit(c, {
          channelId: cid, actorUserId: actorId, action: 'guild.join_mode_changed',
          target: `guild:${guild.id}`, before: { join_mode: guild.join_mode }, after: { join_mode: modo },
        })
        const vagas = guild.member_limit - guild.member_count
        // Sinal para o bot anunciar recrutamento (fase 07). Só faz sentido com vaga.
        if (modo !== 'closed' && vagas > 0 && guild.status === 'active') {
          await emit(c, {
            channelId: cid,
            guildId: guild.id,
            type: 'guild.recruiting',
            payload: { vagas, modo },
            actorUserId: actorId,
          })
        }
      }
    }

    if (description !== undefined || motto !== undefined) {
      assertCan(role, 'text_edit')
      // Limites das colunas (fase 01): estourar viraria 500 em vez de 400.
      if (motto != null && String(motto).length > 80) {
        throw badRequest('TEXT_REJECTED', 'lema acima de 80 caracteres')
      }
      if (description != null && String(description).length > 280) {
        throw badRequest('TEXT_REJECTED', 'descrição acima de 280 caracteres')
      }
      await c.query(
        `UPDATE guild SET description = COALESCE($2, description), motto = COALESCE($3, motto)
          WHERE id = $1`, [guild.id, description ?? null, motto ?? null])
      if (mod) {
        await audit(c, {
          channelId: cid, actorUserId: actorId, action: 'guild.text_edit',
          target: `guild:${guild.id}`,
          before: { description: guild.description, motto: guild.motto },
          after: { description: description ?? guild.description, motto: motto ?? guild.motto },
        })
      }
    }

    const { rows: [now] } = await c.query('SELECT join_mode FROM guild WHERE id = $1', [guild.id])
    // A fila de moderação de texto é da fase 01; aqui só sinalizamos o estado.
    return { join_mode: now.join_mode, description_status: 'pending' }
  }))

  // ---------------------------------------------------------------- dissolver
  app.delete('/guilds/:gid', async (req, reply) => tx(async (c) => {
    // Ação irreversível: exige o painel, nunca o comando de chat (ARQUITETURA
    // §Quem chama o EBS — comando só inicia fluxo).
    if (req.auth.source === 'bot') {
      throw forbidden('CONFIRM_REQUIRED', 'dissolver exige confirmação pelo painel')
    }
    const cid = await channelPk(c, req.auth)
    const actorId = requireUser(req.auth)
    const guild = await lockGuild(c, cid, req.params.gid)
    const { role } = await actorRole(c, req, guild)
    assertCan(role, 'disband')
    if (String(req.body?.confirm_tag ?? '').toUpperCase() !== guild.tag.toUpperCase()) {
      throw badRequest('CONFIRM_MISMATCH', 'TAG de confirmação não bate')
    }
    await disbandGuild(c, guild, actorId)
    reply.code(204)
  }))
}

// ------------------------------------------------------------------ helpers

async function pendingRequest (c, gid, rid) {
  const { rows: [r] } = await c.query(
    'SELECT * FROM guild_join_request WHERE id = $1 AND guild_id = $2 FOR UPDATE', [num(rid), gid])
  if (!r) throw notFound('REQUEST_NOT_FOUND', 'pedido não encontrado')
  // R22: ação repetida sobre estado final é erro de estado e não gera evento novo.
  if (r.status !== 'pending') throw conflict('REQUEST_NOT_PENDING', `pedido já ${r.status}`)
  return r
}

const decide = (c, id, status, actorId) => c.query(
  'UPDATE guild_join_request SET status = $2, decided_by_user_id = $3, decided_at = now() WHERE id = $1',
  [id, status, actorId])

async function lockInvite (c, cid, code, userId) {
  const { rows: [inv] } = await c.query(
    'SELECT * FROM guild_invite WHERE channel_id = $1 AND code = $2 FOR UPDATE', [cid, code])
  // Convite é nominal: para quem não é o convidado ele simplesmente não existe.
  if (!inv || inv.invitee_user_id !== userId) throw notFound('INVITE_NOT_FOUND', 'convite não encontrado')
  if (inv.status !== 'pending') throw conflict('INVITE_NOT_PENDING', `convite já ${inv.status}`)
  return inv
}

/** R21 — todo mundo sai sem cooldown, um único guild.disbanded, guilda sai de active. */
async function disbandGuild (c, guild, actorId, reason = 'disbanded') {
  const { rowCount } = await c.query(
    `INSERT INTO guild_membership_history
       (channel_id, guild_id, user_id, role_at_exit, reason, joined_at, cooldown_until)
     SELECT channel_id, guild_id, user_id, role::text, $2::exit_reason, joined_at, NULL::timestamptz
       FROM guild_member WHERE guild_id = $1`, [guild.id, reason])
  await c.query('DELETE FROM guild_member WHERE guild_id = $1', [guild.id])
  await c.query(
    // 'suspended' e não 'purged': nome e TAG ficam ocupados durante a quarentena
    // de 30 dias (ARQUITETURA §Ciclo de vida). O job de purga fecha o ciclo.
    "UPDATE guild SET status = 'suspended', member_count = 0, leader_user_id = NULL WHERE id = $1",
    [guild.id])
  await emit(c, {
    channelId: guild.channel_id,
    guildId: guild.id,
    type: 'guild.disbanded',
    payload: { actor_user_id: actorId, member_count_at_exit: rowCount },
    actorUserId: actorId,
  })
  return rowCount
}

// ------------------------------------------------------------------ jobs
// Chamados por um agendador (fora do escopo desta fase); exportados para teste.

/** R11/R14 — expira pedidos e convites vencidos. Sem evento: não muda quadro. */
export async function expireStale (client) {
  const { rowCount: pedidos } = await client.query(
    `UPDATE guild_join_request SET status = 'expired', decided_at = now()
      WHERE status = 'pending' AND expires_at <= now()`)
  const { rowCount: convites } = await client.query(
    `UPDATE guild_invite SET status = 'expired', responded_at = now()
      WHERE status = 'pending' AND expires_at <= now()`)
  return { pedidos, convites }
}

/**
 * R20 — sucessão automática: líder sem nenhum guild_event há 30 dias.
 * Promove o membro mais antigo do cargo mais alto disponível.
 */
export async function runSuccession (client) {
  const { rows } = await client.query(
    `SELECT g.* FROM guild g
      WHERE g.status = 'active' AND g.leader_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM guild_event e
           WHERE e.guild_id = g.id AND e.actor_user_id = g.leader_user_id
             AND e.created_at > now() - interval '30 days')
      FOR UPDATE`)

  const promovidos = []
  for (const guild of rows) {
    const { rows: [herdeiro] } = await client.query(
      `SELECT user_id FROM guild_member
        WHERE guild_id = $1 AND role <> 'leader'
        ORDER BY array_position(ARRAY['officer','veteran','member','recruit']::guild_role[], role),
                 joined_at
        LIMIT 1`, [guild.id])
    if (!herdeiro) continue   // guilda só com o líder: R18 cuida quando ele sair
    await transferLeadership(client, guild, guild.leader_user_id, herdeiro.user_id, 'succession', 'system')
    await audit(client, {
      channelId: guild.channel_id, actorUserId: 'system', action: 'guild.leadership_transferred',
      target: `guild:${guild.id}`,
      before: { leader_user_id: guild.leader_user_id }, after: { leader_user_id: herdeiro.user_id },
    })
    promovidos.push({ guild_id: guild.id, leader_user_id: herdeiro.user_id })
  }
  return promovidos
}

/** R18 — guilda vazia há 30 dias vira 'purged'; nome e TAG saem da quarentena. */
export async function purgeEmpty (client) {
  const { rows } = await client.query(
    `UPDATE guild SET status = 'purged'
      WHERE status = 'suspended' AND member_count = 0
        AND id IN (SELECT guild_id FROM guild_event
                    WHERE type IN ('guild.emptied', 'guild.disbanded')
                    GROUP BY guild_id HAVING max(created_at) <= now() - interval '30 days')
      RETURNING id`)
  return rows.map(r => r.id)
}

export { disbandGuild }
