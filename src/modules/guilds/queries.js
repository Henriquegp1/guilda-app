import { forbidden, notFound } from '../../core/errors.js'

/** channel.settings lidos nesta fase (doc §4). */
export const SETTINGS_DEFAULTS = {
  creation_enabled: true,
  creation_bits_cost: 500,
  creation_sku: 'guild_creation',
  name_denylist: [],
  default_member_limit: 10,
  panel_url: null,
}

export const DRAFT_TTL = "15 minutes"

/** O core já resolveu channel.id e settings em req.auth (core/auth.js). */
export async function getChannel (_client, auth) {
  return { id: auth.channelId, settings: { ...SETTINGS_DEFAULTS, ...(auth.settings ?? {}) } }
}

export async function loadGuild (client, channelId, id, forUpdate = false) {
  const { rows } = await client.query(
    `SELECT * FROM guild WHERE id = $1 AND channel_id = $2${forUpdate ? ' FOR UPDATE' : ''}`,
    [Number(id) || 0, channelId])
  if (!rows[0]) throw notFound('GUILD_NOT_FOUND', 'guilda não encontrada')
  return rows[0]
}

export const requireUser = (req) => {
  if (!req.auth.userId) throw forbidden('FORBIDDEN', 'identidade do viewer necessária')
  return req.auth.userId
}

export const isMod = (req) =>
  req.auth.source === 'extension' && ['broadcaster', 'moderator'].includes(req.auth.role)

const PUBLIC_FIELDS = [
  'id', 'name', 'tag', 'description', 'motto',
  'color_primary', 'color_secondary', 'emblem_preset', 'status',
  'leader_user_id', 'level', 'xp', 'prestige', 'member_limit', 'created_at',
]
const PRIVATE_FIELDS = [
  'creator_user_id', 'payment_status', 'bits_amount', 'bits_transaction_id',
  'reserved_until', 'reject_reason', 'reviewed_by_user_id', 'reviewed_at',
]

/** R19/API: bits_* e reject_reason só para líder, criador e mod. */
export const view = (g, withPrivate = false) => Object.fromEntries(
  (withPrivate ? [...PUBLIC_FIELDS, ...PRIVATE_FIELDS] : PUBLIC_FIELDS).map((k) => [k, g[k]]))

export const pageLimit = (raw) => Math.min(Math.max(Number(raw) || 20, 1), 50)
