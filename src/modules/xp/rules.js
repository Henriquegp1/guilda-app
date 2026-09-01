/**
 * Tabela de ganho (§3), limites próprios de cada fonte e teto diário (§4.1).
 * Puro: recebe o evento e o consumo do dia, devolve quanto vale. Sem banco.
 *
 * A chave é o `guild_event.type` — é ele que vira `guild_xp_entry.reason`.
 * Tipo fora desta tabela simplesmente não vale XP.
 */

export const DAILY_CAP = 200
export const REVERSAL = 'xp_reversal'
export const REDEEM = 'channel.channel_points_custom_reward_redemption.add'

/** Sub Tier → XP. Progressão sublinear ao preço, de propósito (§3). */
const SUB_TIER = { 1000: 50, 2000: 100, 3000: 150, prime: 50 }

const GIFT_UNIT = 40
const BITS_PER_XP = 10

/**
 * `cap` é o limite PRÓPRIO da fonte, dentro do dia:
 *   count — nº de eventos que rendem; units — unidades (gift); xp — XP da fonte.
 * `lifetime: true` conta a vida inteira no canal, não o dia (follow).
 */
export const RULES = {
  'watch.tick': { xp: 2, cap: { count: 18 } },
  'chat.message': { xp: 1, cap: { count: 15 } },
  'event.participate': { xp: 5, cap: { count: 4 } },
  'event.win': { xp: 10, cap: { count: 2 } },
  'channel.follow': { xp: 25, cap: { count: 1 }, lifetime: true },
  'channel.subscribe': { xp: 50, tiers: SUB_TIER, cap: {} },
  'channel.subscription.gift': { xp: GIFT_UNIT, cap: { units: 10 }, perUnit: GIFT_UNIT },
  'channel.cheer': { xp: 1, per: `${BITS_PER_XP} bits`, cap: { xp: 100 } },
  [REDEEM]: { xp: 5, cap: { count: 3 } },
}

export const isXpEvent = (type) => type in RULES

const int = (v) => Math.max(0, Math.trunc(Number(v)) || 0)

/** XP bruto do evento, antes de qualquer limite. */
export function baseXp (type, payload = {}) {
  switch (type) {
    case 'watch.tick': return 2
    case 'chat.message': return 1
    case 'event.participate': return 5
    case 'event.win': return 10
    case 'channel.follow': return 25
    // Gift entregue não rende ao presenteado — o crédito é do presenteador (§3).
    case 'channel.subscribe':
      return payload.is_gift ? 0 : (SUB_TIER[payload.tier ?? 1000] ?? SUB_TIER[1000])
    case 'channel.subscription.gift': return GIFT_UNIT * Math.max(1, int(payload.total))
    case 'channel.cheer': return Math.floor(int(payload.bits) / BITS_PER_XP)
    // Só recompensa marcada pelo streamer com a flag (§3).
    case REDEEM: return payload.guild_xp ? 5 : 0
    default: return 0
  }
}

/**
 * Corta pelo limite próprio da fonte. `used` = { xp, count } já concedido no dia
 * (ou na vida, para `lifetime`) nessa mesma fonte.
 */
export function sourceLimited (type, base, used = {}) {
  const rule = RULES[type]
  if (!rule || base <= 0) return 0
  const { count = 0, xp = 0 } = used

  if (rule.cap.count != null) return count >= rule.cap.count ? 0 : base
  if (rule.cap.units != null) {
    const restantes = rule.cap.units - Math.floor(xp / rule.perUnit)
    return Math.max(0, Math.min(base, restantes * rule.perUnit))
  }
  if (rule.cap.xp != null) return Math.max(0, Math.min(base, rule.cap.xp - xp))
  return base
}

/** Teto de 200 XP/dia por (canal, usuário, dia UTC). Excedente é descartado (§4.1). */
export const dailyLimited = (amount, xpToday, cap = DAILY_CAP) =>
  Math.max(0, Math.min(amount, cap - int(xpToday)))

/**
 * Valor final de um evento. `usage`:
 *   { xpToday, bySource: { [type]: { xp, count } } }
 * `capped` marca que algum limite cortou o valor — vai para a coluna do ledger.
 */
export function earn (type, payload, usage = {}) {
  const base = baseXp(type, payload)
  const porFonte = sourceLimited(type, base, usage.bySource?.[type])
  const amount = dailyLimited(porFonte, usage.xpToday)
  return { amount, base, capped: amount < base, reason: type }
}

/** Tabela pública de `GET /xp/table` — o cliente exibe, nunca calcula. */
export const publicTable = () => ({
  cap_daily: DAILY_CAP,
  rules: Object.entries(RULES).map(([type, r]) => ({
    type,
    xp: r.tiers ? Object.values(r.tiers).sort((a, b) => a - b) : r.xp,
    per: r.per ?? null,
    cap: Object.keys(r.cap).length ? r.cap : null,
    lifetime: Boolean(r.lifetime),
  })),
})
