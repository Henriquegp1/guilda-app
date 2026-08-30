import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import { AppError } from './errors.js'
import { query } from './db.js'

// Twitch assina o JWT da extensão em HS256 com o shared secret em base64.
// É o único algoritmo que ela usa, então não entra dependência de JWT aqui.
const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

const unauthorized = (msg) => new AppError(401, 'UNAUTHORIZED', msg)

/**
 * Verifica assinatura e expiração de um JWT HS256 e devolve as claims cruas.
 * O recibo do Bits-in-Extensions usa o mesmo Extension Secret com outro shape de
 * claims, por isso a verificação é separada da leitura (fase 01 duplicava isto).
 */
export function verifyHs256 (token, secretB64 = process.env.TWITCH_EXT_SECRET) {
  if (!secretB64) throw new Error('TWITCH_EXT_SECRET ausente')
  const parts = String(token).split('.')
  if (parts.length !== 3) throw unauthorized('malformed token')

  const [h, p, sig] = parts
  const header = JSON.parse(b64urlDecode(h))
  if (header.alg !== 'HS256') throw unauthorized('unexpected alg')

  const expected = createHmac('sha256', Buffer.from(secretB64, 'base64'))
    .update(`${h}.${p}`).digest()
  const got = b64urlDecode(sig)
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw unauthorized('bad signature')
  }

  const claims = JSON.parse(b64urlDecode(p))
  if (!claims.exp || claims.exp * 1000 <= Date.now()) throw unauthorized('token expired')
  return claims
}

export function verifyTwitchJwt (token, secretB64 = process.env.TWITCH_EXT_SECRET) {
  const claims = verifyHs256(token, secretB64)
  if (!claims.channel_id) throw unauthorized('missing channel_id')

  return {
    twitchChannelId: String(claims.channel_id),
    // user_id só existe se o viewer concedeu identidade; senão só o opaque.
    userId: claims.user_id ?? null,
    opaqueUserId: claims.opaque_user_id ?? null,
    role: claims.role ?? 'viewer',
  }
}

/**
 * twitch_channel_id (texto, do JWT) -> channel.id (bigint, o que o SQL usa).
 * Cria a linha no primeiro toque: a extensão pode ser instalada sem onboarding.
 * ponytail: uma query por request; cachear em Redis se aparecer no perfil.
 */
export async function resolveChannel (twitchChannelId) {
  const { rows } = await query(
    `INSERT INTO channel (twitch_channel_id) VALUES ($1)
       ON CONFLICT (twitch_channel_id)
       DO UPDATE SET twitch_channel_id = EXCLUDED.twitch_channel_id
     RETURNING id, settings`, [String(twitchChannelId)])
  return rows[0]
}

/** Token de canal do bot de chat (ARQUITETURA §Quem chama o EBS). */
export async function verifyChannelToken (token) {
  const { rows } = await query(
    `SELECT t.channel_id, c.twitch_channel_id, c.settings
       FROM channel_token t JOIN channel c ON c.id = t.channel_id
      WHERE t.token = $1 AND t.revoked_at IS NULL`, [token])
  if (!rows[0]) throw unauthorized('invalid channel token')
  return rows[0]
}

export const newChannelToken = () => 'ctk_' + randomBytes(24).toString('base64url')

/**
 * Preenche req.auth. Bot informa o autor do comando em X-Actor-User-Id — o EBS
 * acredita, por isso comando de chat só inicia fluxo (ARQUITETURA).
 *
 * `channelId` é SEMPRE o channel.id interno, nos dois caminhos. Antes ele era
 * texto pela extensão e bigint pelo bot, e cada módulo normalizava do seu jeito
 * — um deles casava com o canal errado quando o chamador era o bot.
 */
export async function authenticate (req) {
  const raw = req.headers.authorization
  if (!raw?.startsWith('Bearer ')) throw unauthorized('missing bearer token')
  const token = raw.slice(7)

  if (token.startsWith('ctk_')) {
    const row = await verifyChannelToken(token)
    req.auth = {
      source: 'bot',
      channelId: row.channel_id,
      twitchChannelId: row.twitch_channel_id,
      settings: row.settings,
      userId: req.headers['x-actor-user-id'] ?? null,
      role: 'viewer',
    }
  } else {
    const claims = verifyTwitchJwt(token)
    const channel = await resolveChannel(claims.twitchChannelId)
    req.auth = { ...claims, source: 'extension', channelId: channel.id, settings: channel.settings }
  }
}

/** Rotas de moderação: broadcaster ou moderator, e nunca vindas do bot. */
export function requireModerator (req) {
  if (req.auth.source !== 'extension' || !['broadcaster', 'moderator'].includes(req.auth.role)) {
    throw new AppError(403, 'FORBIDDEN', 'requer broadcaster ou moderator')
  }
}
