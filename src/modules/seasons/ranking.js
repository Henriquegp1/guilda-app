/**
 * Ordenação do ranking (§5.2) e o cursor da paginação (§5.3). Puro.
 *
 * O comparador e o ORDER BY do snapshot precisam concordar: se divergirem, a
 * posição do card "sua guilda" (calculada ao vivo) contradiz a da lista.
 * `RANK_ORDER_SQL` é a mesma regra escrita em SQL, e o teste guarda os dois.
 */

/** Aliases fixos: `p` = guild_season_prestige, `g` = guild. */
export const RANK_ORDER_SQL =
  'p.prestige DESC, p.last_gain_at ASC NULLS LAST, g.created_at ASC, g.id ASC'

// Guilda sem ganho nenhum vai para o fim do empate — NULLS LAST do SQL.
const ms = (v) => (v == null ? Infinity : +new Date(v))
const byTime = (a, b) => (ms(a) === ms(b) ? 0 : ms(a) < ms(b) ? -1 : 1)

/**
 * Ordem total das 4 chaves de desempate (§5.2). Nunca devolve 0 para guildas
 * diferentes, e é isso que garante pódio sem empate (R11).
 */
export function compareRank (a, b) {
  return (Number(b.prestige) || 0) - (Number(a.prestige) || 0)
    || byTime(a.last_gain_at, b.last_gain_at)
    || byTime(a.created_at, b.created_at)
    || (Number(a.guild_id) - Number(b.guild_id))
}

/** Aplica a ordem e materializa `position` 1..N. */
export const rankRows = (rows) =>
  [...rows].sort(compareRank).map((row, i) => ({ ...row, position: i + 1 }))

// ------------------------------------------------------------------ cursor
// Opaco de propósito: o cliente devolve o que recebeu e não constrói cursor.

export const encodeCursor = ({ snapshot_id, position }) =>
  Buffer.from(JSON.stringify({ s: Number(snapshot_id), p: Number(position) })).toString('base64url')

/** Devolve null (não lança) quando o cursor não é nosso — quem traduz é a rota. */
export function decodeCursor (raw) {
  if (!raw) return null
  try {
    const { s, p } = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'))
    if (!Number.isFinite(s) || !Number.isFinite(p) || s <= 0 || p < 0) return null
    return { snapshot_id: s, position: p }
  } catch {
    return null
  }
}

/** §5.3 — snapshot não-final com mais de 10 min expira o cursor. */
export const CURSOR_TTL_MS = 10 * 60_000
export const cursorExpired = (snapshot, now = Date.now()) =>
  !snapshot.is_final && now - +new Date(snapshot.taken_at) > CURSOR_TTL_MS

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100
