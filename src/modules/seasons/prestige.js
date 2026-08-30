/**
 * Fontes de Prestígio (§4.1), bônus de sequência e o objetivo semanal.
 * Puro: recebe o evento, devolve pontos. Sem banco, sem I/O — é aqui que os
 * testes moram.
 *
 * O eixo é o `guild_event.type`, que vira `prestige_ledger.source`. Tipo fora
 * desta tabela vale 0 e não gera linha no ledger.
 */

export const POINTS = {
  win: 500,
  placement: { 2: 300, 3: 150 },
  participate: 10,
  weekly: 250,
  levelUp: 100,
  streak: 200,
}

/** R5 — participação só conta os 20 primeiros membros do evento (máx. 200). */
export const PARTICIPATE_CAP = 20

/** R16 — faixa do ajuste manual do broadcaster. */
export const MAX_ADJUST = 5000

export const STREAK_DAYS = 3
export const STREAK_WINDOW_MS = 7 * 86_400_000

/**
 * R3 — O PRINCÍPIO DO PRODUTO: nenhuma fonte monetária vale Prestígio.
 * Bits, subs, gifts e resgate de pontos compram criação e cosmético (fases 01/06),
 * nunca posição no ranking. A lista existe para o zero ser explícito e testável,
 * não como otimização — qualquer tipo fora do `switch` já valeria 0.
 */
export const MONETARY_TYPES = new Set([
  'channel.cheer',
  'channel.subscribe',
  'channel.subscription.gift',
  'channel.subscription.end',
  'channel.channel_points_custom_reward_redemption.add',
  'channel.follow',
])

/** Tipos que o handler varre em `guild_event`. `streak` é derivado, não é evento. */
export const PRESTIGE_TYPES = [
  'event.win', 'event.placement', 'event.participate',
  'weekly.objective_completed', 'guild.level_up', 'prestige.manual_adjust',
]

const int = (v) => Math.trunc(Number(v)) || 0

export const clampAdjust = (n) => Math.max(-MAX_ADJUST, Math.min(MAX_ADJUST, int(n)))

/**
 * Pontos de um evento. `contributors` = quantos membros da guilda já pontuaram
 * neste mesmo evento (só usado por `event.participate`).
 */
export function prestigeFor (type, payload = {}, { contributors = 0 } = {}) {
  if (MONETARY_TYPES.has(type)) return 0                                   // R3
  switch (type) {
    case 'event.win': return POINTS.win
    case 'event.placement': return POINTS.placement[int(payload.rank)] ?? 0
    case 'event.participate':                                              // R5
      return int(contributors) >= PARTICIPATE_CAP ? 0 : POINTS.participate
    case 'weekly.objective_completed': return POINTS.weekly
    // Queda de nível não tira Prestígio; só a subida credita.
    case 'guild.level_up': return int(payload.to) > int(payload.from) ? POINTS.levelUp : 0
    case 'prestige.manual_adjust': return clampAdjust(payload.amount)      // R16
    // Crédito automático da fase 05. Separado de manual_adjust de propósito: um
    // é correção humana auditável, o outro é o sistema fechando a conta — juntar
    // os dois faz o log de auditoria mentir sobre quem mexeu no Prestígio.
    case 'war.prestige_awarded':
    case 'territory.yield': return clampAdjust(payload.amount)
    default: return 0
  }
}

/** Total de participação de um evento com N membros — o teto fecha em 200. */
export const participateTotal = (members) =>
  Math.max(0, Math.min(int(members), PARTICIPATE_CAP)) * POINTS.participate

const utcDay = (t) => new Date(t).toISOString().slice(0, 10)

/** Dias UTC distintos com vitória em (at − 7d, at]. */
export function winDaysInWindow (timestamps, at, windowMs = STREAK_WINDOW_MS) {
  const end = +new Date(at)
  const start = end - windowMs
  const days = new Set()
  for (const t of timestamps) {
    const ms = +new Date(t)
    if (ms > start && ms <= end) days.add(utcDay(ms))
  }
  return days.size
}

/** §4.1 — vencer em 3 dias distintos dentro de 7 dias corridos vale +200. */
export const qualifiesForStreak = (timestamps, at) =>
  winDaysInWindow(timestamps, at) >= STREAK_DAYS

// --------------------------------------------------------- objetivo semanal
// D1/README: sem isto o ranking de canal pequeno nasce parado, porque `event.win`
// só ganha um gerador robusto na fase 05. Não é opcional.

/**
 * Tipos que contam como atividade da semana. Monetário fica de fora de propósito:
 * se cheer contasse, Bits comprariam os 250 pontos por via indireta (R3).
 */
export const ACTIVITY_TYPES = [
  'watch.tick', 'event.participate', 'event.win',
  'member.joined', 'join.approved', 'invite.accepted',
]

export const WEEKLY_OBJECTIVE = {
  code: 'active_week',
  points: POINTS.weekly,
  min_members: 3,
  min_days: 3,
  description: '3 membros distintos ativos em 3 dias distintos da semana',
}

export const weeklyObjectiveMet = ({ members = 0, days = 0 } = {}) =>
  int(members) >= WEEKLY_OBJECTIVE.min_members && int(days) >= WEEKLY_OBJECTIVE.min_days

const midnightUtc = (date) => new Date(`${new Date(date).toISOString().slice(0, 10)}T00:00:00.000Z`)

/** Chave ISO-8601 da semana, em UTC (R10). `2026-W35`. */
export function isoWeek (date = new Date()) {
  const d = midnightUtc(date)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3)   // quinta define o ano ISO
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3)
  const week = 1 + Math.round((+d - +firstThursday) / (7 * 86_400_000))
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** Semana ISO como intervalo [segunda, próxima segunda) em UTC. */
export function weekRange (date = new Date()) {
  const start = midnightUtc(date)
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  return { key: isoWeek(start), start, end: new Date(+start + 7 * 86_400_000) }
}
