/**
 * Placar ao vivo (§7). Um único `war.board` agregado carrega TODAS as guerras
 * ativas do canal, porque o tópico `broadcast` do PubSub aceita 1 msg/s e 5 KB —
 * uma mensagem por guerra estoura o limite num canal grande (D5).
 *
 * Puro: monta e mede a mensagem. O transporte é `publishBoard` no index.js.
 */

/** Limite duro do tópico PubSub da Twitch. */
export const BOARD_LIMIT_BYTES = 5120
/** §7 — até 8 pares por mensagem; o resto só via GET /wars/active. */
export const MAX_WARS_PER_BOARD = 8

const side = (w, which) => ({
  guild_id: w[`${which}_guild_id`],
  tag: w[`${which}_tag`] ?? null,
  score: Math.max(0, Number(w[`score_${which}`]) || 0),
})

const row = (w) => ({
  war_id: w.id,
  format: w.format,
  seq: Number(w.score_seq) || 0,
  ends_at: w.ends_at instanceof Date ? w.ends_at.toISOString() : w.ends_at ?? null,
  challenger: side(w, 'challenger'),
  defender: side(w, 'defender'),
})

export const boardBytes = (message) => Buffer.byteLength(JSON.stringify(message), 'utf8')

/**
 * Monta a mensagem `war.board`. Corta pelo fim da lista até caber em `limitBytes`
 * — as guerras vêm ordenadas por relevância pelo chamador (mais recentes primeiro),
 * então quem cai é a menos interessante. `dropped` diz quantas ficaram de fora.
 */
export function buildBoard (wars = [], { channelId, seq = 0, sentAt = new Date(), limitBytes = BOARD_LIMIT_BYTES, maxWars = MAX_WARS_PER_BOARD } = {}) {
  const rows = wars.slice(0, maxWars).map(row)
  const message = {
    type: 'war.board',
    channel_id: channelId,
    seq,
    sent_at: sentAt instanceof Date ? sentAt.toISOString() : sentAt,
    wars: rows,
  }

  while (rows.length > 1 && boardBytes(message) > limitBytes) rows.pop()
  const bytes = boardBytes(message)

  return { message, bytes, dropped: wars.length - rows.length, truncated: bytes > limitBytes }
}

/** Mensagem final da guerra (§7): o card congela com selo `apurando` até `war.settled`. */
export const buildEnded = (war) => ({
  type: 'war.ended',
  war_id: war.id,
  seq: Number(war.score_seq) || 0,
  winner_guild_id: war.winner_guild_id ?? null,
  score: { challenger: war.score_challenger, defender: war.score_defender },
})
