import { randomBytes } from 'node:crypto'
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js'
import { emit } from '../../core/events.js'
import { cooldownUntil, exitCooldown, retryAfter } from './cooldown.js'

export const err = (status, code, msg) => new AppError(status, code, msg)

/** O core já resolveu channel.id em req.auth (core/auth.js). */
export async function channelPk (_client, auth) {
  return auth.channelId
}

/** Convite nominal exige identidade real (risco 5 da fase 02). */
export function requireUser (auth) {
  if (!auth.userId) throw forbidden('IDENTITY_REQUIRED', 'requer consentimento de identidade')
  return auth.userId
}

/** id vindo da rota: coagido a número para um :gid lixo virar 404, não erro de cast. */
export const num = (v) => Number(v) || 0

export async function lockGuild (client, channelId, gid) {
  const { rows } = await client.query(
    'SELECT * FROM guild WHERE id = $1 AND channel_id = $2 FOR UPDATE', [num(gid), channelId])
  if (!rows[0]) throw notFound('GUILD_NOT_FOUND', 'guilda não encontrada')
  return rows[0]
}

export async function getGuild (client, channelId, gid) {
  const { rows } = await client.query(
    'SELECT * FROM guild WHERE id = $1 AND channel_id = $2', [num(gid), channelId])
  if (!rows[0]) throw notFound('GUILD_NOT_FOUND', 'guilda não encontrada')
  return rows[0]
}

/** Membership ativa do viewer no canal — R1 garante no máximo uma. */
export async function membershipOf (client, channelId, userId) {
  const { rows } = await client.query(
    'SELECT * FROM guild_member WHERE channel_id = $1 AND user_id = $2', [channelId, userId])
  return rows[0] ?? null
}

export async function memberIn (client, gid, userId) {
  const { rows } = await client.query(
    'SELECT * FROM guild_member WHERE guild_id = $1 AND user_id = $2', [gid, userId])
  return rows[0] ?? null
}

/** R12 — cooldown do viewer para esta guilda, olhando 7 dias de histórico. */
export async function assertNoCooldown (client, channelId, userId, gid) {
  const { rows } = await client.query(
    `SELECT guild_id, reason, left_at, cooldown_until
       FROM guild_membership_history
      WHERE channel_id = $1 AND user_id = $2 AND left_at > now() - interval '7 days'`,
    [channelId, userId])
  const until = cooldownUntil(rows, gid)
  if (until) {
    throw err(429, 'JOIN_COOLDOWN',
      `aguarde ${retryAfter(until)}s para entrar em outra guilda`)
  }
}

/** R2 + R1 + R3: guilda aceita mais um, e o viewer pode entrar. Guilda já travada. */
export async function assertJoinable (client, guild, userId) {
  if (guild.status !== 'active') throw conflict('GUILD_NOT_ACTIVE', 'guilda não está ativa')
  if (await membershipOf(client, guild.channel_id, userId)) {
    throw conflict('ALREADY_IN_GUILD', 'viewer já pertence a uma guilda neste canal')
  }
  if (guild.member_count >= guild.member_limit) {
    throw conflict('GUILD_FULL', `guilda cheia (${guild.member_count}/${guild.member_limit})`)
  }
  await assertNoCooldown(client, guild.channel_id, userId, guild.id)
}

/** R6: toda via entra como vassalo, exceto o primeiro que entra como sub-lider. */
export async function addMember (client, guild, userId, { via, invitedBy = null, actorUserId = null }) {
  // Se a guilda só tem o líder (member_count = 1), o novo membro é sub-lider
  const role = guild.member_count === 1 ? 'sub-lider' : 'vassalo'

  await client.query(
    `INSERT INTO guild_member (guild_id, user_id, channel_id, role, invited_by_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [guild.id, userId, guild.channel_id, role, invitedBy])

  await client.query(
    `UPDATE guild SET member_count = (SELECT count(*)::int FROM guild_member WHERE guild_id = $1)
      WHERE id = $1`, [guild.id])

  await emit(client, {
    channelId: guild.channel_id,
    guildId: guild.id,
    type: 'member.joined',
    payload: { user_id: userId, role, via },
    actorUserId: actorUserId ?? userId,
  })
}

/** Garante que sempre exista um sub-lider na guilda se houver mais de 1 membro. */
async function ensureSubLider(client, guildId, actorId = 'system') {
  const { rows: [sub] } = await client.query(
    "SELECT 1 FROM guild_member WHERE guild_id = $1 AND role::text IN ('sub-lider', 'officer')", [guildId]
  )
  if (sub) return

  // Se não houver sub-líder, promove o membro mais antigo que não seja o líder
  const { rows: [alvo] } = await client.query(
    "SELECT user_id FROM guild_member WHERE guild_id = $1 AND role::text NOT IN ('lider', 'leader') ORDER BY joined_at ASC LIMIT 1",
    [guildId]
  )
  if (alvo) {
    await client.query(
      "UPDATE guild_member SET role = 'sub-lider', role_changed_at = now(), role_changed_by = $3 WHERE guild_id = $1 AND user_id = $2",
      [guildId, alvo.user_id, actorId]
    )
  }
}

/**
 * Saída de um membro: histórico + cooldown + contagem + evento, tudo na mesma
 * transação (R22). Emite guild.emptied e suspende a guilda se esvaziou (R18).
 */
export async function removeMember (client, guild, member, { reason, actorUserId = null, emitEvent = true }) {
  await client.query('DELETE FROM guild_member WHERE guild_id = $1 AND user_id = $2',
    [guild.id, member.user_id])
  await client.query(
    `INSERT INTO guild_membership_history
       (channel_id, guild_id, user_id, role_at_exit, reason, actor_user_id, joined_at, cooldown_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [guild.channel_id, guild.id, member.user_id, member.role, reason, actorUserId,
      member.joined_at, exitCooldown(reason)])

  // Recalcula e atualiza a contagem real garantindo que nunca fique negativa
  const { rows: [upd] } = await client.query(
    `WITH cnt AS (SELECT count(*)::int AS n FROM guild_member WHERE guild_id = $1)
     UPDATE guild SET member_count = cnt.n FROM cnt WHERE id = $1
     RETURNING guild.member_count AS left`,
    [guild.id])
  const left = upd?.left ?? 0

  if (emitEvent) {
    await emit(client, {
      channelId: guild.channel_id,
      guildId: guild.id,
      type: reason === 'kicked' ? 'member.kicked' : 'member.left',
      payload: reason === 'kicked'
        ? { user_id: member.user_id, role_at_exit: member.role, actor_user_id: actorUserId }
        : { user_id: member.user_id, role_at_exit: member.role },
      actorUserId: actorUserId ?? member.user_id,
    })
  }

  // R18: último membro saiu. Guilda vazia não é 'active' e não tem líder.
  if (left <= 0 && emitEvent) {
    await client.query("UPDATE guild SET status = 'suspended', leader_user_id = NULL, member_count = 0 WHERE id = $1",
      [guild.id])
    await emit(client, {
      channelId: guild.channel_id,
      guildId: guild.id,
      type: 'guild.emptied',
      payload: { actor_user_id: actorUserId, member_count_at_exit: 0 },
      actorUserId,
    })
  } else if (left > 0) {
    await ensureSubLider(client, guild.id, actorUserId)
  }
  return left
}

/**
 * R19 — transferência atômica. Rebaixa o líder antes de promover o alvo.
 */
export async function transferLeadership (client, guild, fromUserId, toUserId, mode, actorUserId) {
  await client.query(
    `UPDATE guild_member SET role = 'sub-lider', role_changed_at = now(), role_changed_by = $3
      WHERE guild_id = $1 AND user_id = $2`, [guild.id, fromUserId, actorUserId])
  await client.query(
    `UPDATE guild_member SET role = 'lider', role_changed_at = now(), role_changed_by = $3
      WHERE guild_id = $1 AND user_id = $2`, [guild.id, toUserId, actorUserId])
  await client.query('UPDATE guild SET leader_user_id = $2 WHERE id = $1', [guild.id, toUserId])

  await emit(client, {
    channelId: guild.channel_id,
    guildId: guild.id,
    type: 'guild.leadership_transferred',
    payload: { from_user_id: fromUserId, to_user_id: toUserId, mode },
    actorUserId,
  })
}

export const newInviteCode = () => randomBytes(12).toString('base64url').slice(0, 22)
