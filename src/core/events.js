import { conflict } from './errors.js'

/**
 * Registro de tipos válidos. Espelha docs/EVENTOS.md — um tipo que não está aqui
 * não entra no banco. É o que impede produtor e consumidor de divergirem.
 */
export const EVENT_TYPES = new Set([
  // 01
  'guild.created', 'guild.approved', 'guild.rejected', 'guild.moderated',
  // 02
  'member.joined', 'member.left', 'member.kicked', 'member.promoted', 'member.demoted',
  'join.requested', 'join.approved', 'join.rejected',
  'invite.created', 'invite.accepted', 'invite.declined',
  'guild.leadership_transferred', 'guild.join_mode_changed',
  'guild.emptied', 'guild.disbanded', 'guild.recruiting',
  // 03
  'guild.level_up', 'watch.tick',
  // 04
  'event.win', 'event.placement', 'event.participate',
  'weekly.objective_completed', 'prestige.manual_adjust',
  'season.started', 'season.ended', 'achievement.unlocked',
  // 05
  'war.declared', 'war.accepted', 'war.declined',
  'war.started', 'war.ended', 'war.settled', 'war.prestige_awarded', 'territory.yield',
  'territory.captured', 'territory.lost', 'dispute.opened', 'dispute.closed',
  // 07
  'ranking.top1_changed', 'ranking.top3_entered',
  // 06
  'identity.changed', 'emblem.changed',
  // Twitch EventSub, gravados com o type original (docs/EVENTOS.md)
  'channel.cheer', 'channel.subscribe', 'channel.subscription.gift',
  'channel.subscription.end', 'channel.follow',
  'channel.channel_points_custom_reward_redemption.add',
])

/**
 * Insere um guild_event. Sempre dentro da mesma transação que muda o estado.
 *
 * `externalId` presente = evento vindo da Twitch, que reenvia webhook: o INSERT é
 * idempotente e retorna null quando já existia. Chamador que recebe null não deve
 * aplicar o efeito de novo.
 */
export async function emit (client, { channelId, guildId = null, type, payload = {}, actorUserId = null, externalId = null }) {
  if (!EVENT_TYPES.has(type)) {
    throw new Error(`guild_event.type desconhecido: ${type} — registre em docs/EVENTOS.md`)
  }

  const { rows } = await client.query(
    `INSERT INTO guild_event (channel_id, guild_id, type, payload, actor_user_id, external_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (channel_id, type, external_id) WHERE external_id IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    [channelId, guildId, type, payload, actorUserId, externalId])

  return rows[0] ?? null
}

/** Igual a emit, mas trata duplicata como erro em vez de silêncio. */
export async function emitOnce (client, ev, code = 'EVENT_ALREADY_APPLIED') {
  const row = await emit(client, ev)
  if (!row) throw conflict(code, `evento ${ev.type} já processado`)
  return row
}

export async function audit (client, { channelId, actorUserId, action, target, before = null, after = null }) {
  await client.query(
    `INSERT INTO audit_log (channel_id, actor_user_id, action, target, before, after)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [channelId, actorUserId, action, target, before, after])
}
