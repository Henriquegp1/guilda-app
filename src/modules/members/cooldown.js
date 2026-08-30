/** R12 — cooldown de reentrada, por canal. Pura, sem banco: dá para testar. */

const H = 3600_000

export const COOLDOWN_H = {
  left: 24,          // saída voluntária: qualquer guilda do canal
  kicked_same: 72,   // expulsão: a mesma guilda
  kicked_other: 24,  // expulsão: as demais guildas do canal
  rejected: 24,      // pedido recusado: pedir de novo à mesma guilda
}

/** Prazo gravado em guild_membership_history.cooldown_until na hora da saída. */
export function exitCooldown (reason, at = new Date()) {
  const hours = { left: COOLDOWN_H.left, kicked: COOLDOWN_H.kicked_same }[reason]
  return hours ? new Date(at.getTime() + hours * H) : null   // disbanded/purged: sem cooldown
}

/**
 * Até quando o viewer está travado para entrar em `guildId`, dado o histórico dele
 * no canal. `null` = livre. A linha já carrega o prazo forte (24 h saída, 72 h
 * expulsão na mesma guilda); a expulsão ainda trava as outras guildas por 24 h.
 */
export function cooldownUntil (rows, guildId, now = new Date()) {
  let until = null
  for (const r of rows) {
    const same = String(r.guild_id) === String(guildId)
    const t = (!same && r.reason === 'kicked')
      ? new Date(new Date(r.left_at).getTime() + COOLDOWN_H.kicked_other * H)
      : (r.cooldown_until ? new Date(r.cooldown_until) : null)
    if (t && t > now && (!until || t > until)) until = t
  }
  return until
}

export const retryAfter = (until, now = new Date()) =>
  Math.max(0, Math.ceil((until - now) / 1000))
