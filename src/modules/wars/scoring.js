/**
 * Pontos de guerra (§6), roster simétrico (§6) e anti-conluio (R11). Puro.
 *
 * WP não reusa XP nem Prestígio: é um ledger próprio sobre o MESMO `guild_event`,
 * com pesos e janela próprias (§6). A chave da tabela é o `guild_event.type` —
 * tipo fora dela vale 0, sem `default` genérico.
 */
import { DAY, FORMATS } from './machine.js'

export const REDEEM = 'channel.channel_points_custom_reward_redemption.add'

/**
 * §6, com os nomes do catálogo da fase 03 onde eles divergem do doc (o doc manda
 * seguir a fase 03 e manter o peso):
 *   watch_tick            -> watch.tick
 *   channel_points_redeem -> channel.channel_points_custom_reward_redemption.add
 *   minigame_win          -> event.win
 *   achievement_unlocked  -> achievement.unlocked
 * `daily_checkin`, `chat_message`, `raid_participation` e `rpg_duel_win` não têm
 * produtor registrado hoje (D7): a linha fica, e simplesmente não gera evento.
 */
export const WP_TABLE = {
  daily_checkin: { points: 30, cap: 30 },
  'watch.tick': { points: 1, cap: 60 },
  chat_message: { points: 1, cap: 30 },
  [REDEEM]: { points: 10, cap: 50 },
  'event.win': { points: 15, cap: 75 },
  raid_participation: { points: 25, cap: 25 },
  rpg_duel_win: { points: 20, cap: 100 },
  'achievement.unlocked': { points: 40, cap: 80 },
}

/** Tipos que o handler varre em `guild_event`. */
export const WP_TYPES = Object.keys(WP_TABLE)

/** R9 — teto global por membro por dia UTC. Excedente é descartado. */
export const DAILY_CAP = 250

/**
 * R10 — O PRINCÍPIO DO PROJETO: dinheiro não compra guerra. Bits, subs, gifts e
 * fim de assinatura valem 0 WP em qualquer formato. A lista existe para o zero
 * ser explícito e testável — qualquer tipo fora de WP_TABLE já valeria 0.
 */
export const MONETARY_TYPES = new Set([
  'channel.cheer', 'channel.subscribe', 'channel.subscription.gift',
  'channel.subscription.end', 'channel.follow',
  'bits_cheer', 'sub', 'sub_gift',
])

export const isMonetary = (type) => MONETARY_TYPES.has(type) || String(type).startsWith('bits')

// hasOwn e não `WP_TABLE[type]`: 'toString' e 'constructor' vêm do prototype e
// virariam ponto sem estarem na tabela.
const ruleFor = (type) => (Object.hasOwn(WP_TABLE, type) ? WP_TABLE[type] : null)

/** WP bruto de um evento, antes de qualquer teto. */
export function wpFor (type, payload = {}) {
  if (isMonetary(type)) return 0                                          // R10
  const rule = ruleFor(type)
  if (!rule) return 0
  // §6: só o resgate marcado pelo streamer como "ação de guerra" pontua.
  if (type === REDEEM && !payload?.war_action) return 0
  return rule.points
}

/**
 * Valor final do evento. `used` = { total, bySource } do MESMO membro, na mesma
 * guerra, no mesmo dia UTC do evento.
 */
export function grantWp (type, payload = {}, used = {}) {
  const base = wpFor(type, payload)
  if (!base) return 0
  const room = Math.min(
    ruleFor(type).cap - Math.max(0, Number(used.bySource?.[type]) || 0),
    DAILY_CAP - Math.max(0, Number(used.total) || 0),
  )
  return Math.max(0, Math.min(base, room))
}

export const utcDay = (t) => new Date(t).toISOString().slice(0, 10)

/** Tabela pública para a extensão exibir — o cliente nunca soma WP (§7). */
export const publicWpTable = () => ({
  cap_daily: DAILY_CAP,
  rules: Object.entries(WP_TABLE).map(([type, r]) => ({ type, wp: r.points, cap_daily: r.cap })),
})

// ------------------------------------------------------------------ roster (§6)

export const ROSTER_MIN = 3
export const ROSTER_MAX = 25

/**
 * Roster simétrico: os dois lados inscrevem exatamente `min(ativos_A, ativos_B, 25)`.
 * Sem banda de matchmaking e sem normalização por média — 50 × 10 vira 10 × 10.
 * Abaixo de ROSTER_MIN a guerra não abre (422 WAR_ROSTER_TOO_SMALL).
 */
export const rosterSize = (activeA, activeB) =>
  Math.max(0, Math.min(Math.trunc(activeA) || 0, Math.trunc(activeB) || 0, ROSTER_MAX))

export const rosterTooSmall = (size) => size < ROSTER_MIN

// --------------------------------------------------------- anti-conluio (R6, R11)

/** R6 — a mesma dupla só reabre 24 h depois de a anterior sair do estado aberto. */
export const PAIR_COOLDOWN_MS = 24 * 60 * 60_000
/** R11(a) — dupla que já apurou nos últimos 14 dias apura a 0.25. */
export const REPEAT_WINDOW_MS = 14 * DAY
export const REPEAT_MULTIPLIER = 0.25
/** R11(b) — 2 guerras com Prestígio integral por semana ISO; da 3ª em diante, 0. */
export const WEEKLY_FULL_WARS = 2

/** R5 — ghosting: 3 desafios expirados em 7 dias bloqueiam declarar por 72 h. */
export const GHOST_WINDOW_MS = 7 * DAY
export const GHOST_LIMIT = 3
export const GHOST_BLOCK_MS = 72 * 60 * 60_000
/** R19 — 2 desafios de stake expirados em 7 dias liberam o território. */
export const TERRITORY_GHOST_LIMIT = 2

/**
 * Multiplicador de Prestígio da apuração. `settledThisWeek` é quantas guerras a
 * guilda JÁ apurou com Prestígio nesta semana ISO (no_contest e cancelled não contam).
 * O par repetido só derruba para 0.25; o teto semanal zera.
 */
export function prestigeMultiplier ({ repeatedPair = false, settledThisWeek = 0 } = {}) {
  if (settledThisWeek >= WEEKLY_FULL_WARS) return 0
  return repeatedPair ? REPEAT_MULTIPLIER : 1
}

/**
 * R8/R14 — resultado da guerra a partir do placar congelado.
 * Desempate do `special`: territórios detidos, depois WP do último dia (§5).
 */
export function resolveWar ({ format, challenger, defender }) {
  const spec = FORMATS[format]
  const a = Math.max(0, Number(challenger.score) || 0)
  const b = Math.max(0, Number(defender.score) || 0)

  if ((a === 0 && b === 0) || Math.max(a, b) < spec.minPoints) {
    return { status: 'no_contest', winnerGuildId: null }                  // R8
  }
  if (a !== b) {
    return { status: 'settled', winnerGuildId: a > b ? challenger.guildId : defender.guildId }
  }
  if (format === 'special') {
    for (const k of ['territories', 'lastDayScore']) {
      const x = Number(challenger[k]) || 0
      const y = Number(defender[k]) || 0
      if (x !== y) {
        return { status: 'settled', winnerGuildId: x > y ? challenger.guildId : defender.guildId }
      }
    }
  }
  return { status: 'settled', winnerGuildId: null }                        // R14: empate
}

/**
 * Prestígio de cada lado, já com o multiplicador (R11). Nunca negativo (§5) e
 * chaveado por guild_id, no shape de `war.prestige_awarded`.
 */
export function prestigeAwards (format, { challengerGuildId, defenderGuildId, winnerGuildId = null, multiplier = 1, noContest = false }) {
  const p = FORMATS[format].prestige
  const scale = (n) => Math.max(0, Math.round(n * multiplier))
  if (noContest) return { [challengerGuildId]: 0, [defenderGuildId]: 0 }   // R8
  if (!winnerGuildId) {
    return { [challengerGuildId]: scale(p.draw), [defenderGuildId]: scale(p.draw) }
  }
  const loser = String(winnerGuildId) === String(challengerGuildId)
    ? defenderGuildId
    : challengerGuildId
  return { [winnerGuildId]: scale(p.winner), [loser]: scale(p.loser) }
}
