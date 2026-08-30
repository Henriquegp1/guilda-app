/**
 * Formatos (§5) e a máquina de estados da guerra (§4). Puro: sem banco, sem I/O.
 * É aqui que os números fechados do doc moram e onde os testes batem.
 */
import { conflict } from '../../core/errors.js'

export const MIN = 60_000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

/** §5 — valores fechados. `prestige` é o que a guerra vale antes do multiplicador (R11). */
export const FORMATS = {
  skirmish: {
    challengeTtlMs: 2 * HOUR,
    startDelayMs: 5 * MIN,
    durationMs: 6 * HOUR,
    minPoints: 200,
    prestige: { winner: 150, loser: 40, draw: 80 },
    endsOnOffline: true,
    allowsStake: false,
  },
  campaign: {
    challengeTtlMs: 24 * HOUR,
    startsAtNextUtcMidnight: true,
    durationMs: 7 * DAY,
    minPoints: 800,
    prestige: { winner: 500, loser: 120, draw: 250 },
    endsOnOffline: false,
    allowsStake: false,
  },
  special: {
    challengeTtlMs: 24 * HOUR,
    windowDays: { min: 1, max: 14 },
    minPoints: 1500,
    prestige: { winner: 900, loser: 200, draw: 450 },
    endsOnOffline: false,
    allowsStake: true,
  },
}

export const FORMAT_KEYS = Object.keys(FORMATS)
export const isFormat = (f) => Object.hasOwn(FORMATS, f)

/** Janela de contestação depois de `ended` (R15) e antes de `war:settle`. */
export const SETTLE_GRACE_MS = 10 * MIN
/** `skirmish` encerra depois deste tempo sem sinal de live (§7). */
export const OFFLINE_GRACE_MS = 15 * MIN

/** Estados que ocupam o `war_slot` da guilda (R1). */
export const OPEN_STATES = ['pending', 'accepted', 'active']

/**
 * Transições válidas. Tudo que não está aqui é recusado — inclusive os atalhos
 * "óbvios" (pending → active, active → settled), que pulariam roster travado ou
 * a janela de contestação.
 *
 * `cancelled` sai de qualquer estado aberto e de `ended`: o doc desenha as setas
 * a partir de `active` e `ended`, mas R13 (guilda banida) e a queda de live antes
 * de `starts_at` (§7) também matam guerra em `pending`/`accepted`.
 */
export const TRANSITIONS = {
  pending: ['accepted', 'declined', 'expired', 'cancelled'],
  accepted: ['active', 'cancelled'],
  active: ['ended', 'cancelled'],
  ended: ['settled', 'no_contest', 'cancelled'],
  declined: [],
  expired: [],
  settled: [],
  no_contest: [],
  cancelled: [],
}

export const WAR_STATES = Object.keys(TRANSITIONS)
// hasOwn e não `TRANSITIONS[x]`: 'toString' e 'constructor' viriam do prototype
// e um estado inventado passaria como válido.
const outOf = (state) => (Object.hasOwn(TRANSITIONS, state) ? TRANSITIONS[state] : null)
export const isTerminal = (state) => outOf(state)?.length === 0
export const canTransition = (from, to) => Boolean(outOf(from)?.includes(to))

export function assertTransition (from, to) {
  if (!canTransition(from, to)) {
    throw conflict('WAR_INVALID_TRANSITION', `guerra em ${from} não vai para ${to}`,
      { from, to })
  }
  return to
}

const at = (v) => (v instanceof Date ? v : new Date(v))

export const challengeExpiresAt = (format, declaredAt = new Date()) =>
  new Date(+at(declaredAt) + FORMATS[format].challengeTtlMs)

export const nextUtcMidnight = (from = new Date()) => {
  const d = at(from)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1))
}

/**
 * Janela da guerra (§4, tabela de transições). `special` traz a janela pronta do
 * broadcaster; os outros dois derivam do instante do aceite.
 */
export function warWindow (format, { acceptedAt = new Date(), opensAt = null, closesAt = null } = {}) {
  const spec = FORMATS[format]
  if (format === 'special') {
    const startsAt = at(opensAt)
    return { startsAt, endsAt: at(closesAt) }
  }
  const startsAt = spec.startsAtNextUtcMidnight
    ? nextUtcMidnight(acceptedAt)
    : new Date(+at(acceptedAt) + spec.startDelayMs)
  return { startsAt, endsAt: new Date(+startsAt + spec.durationMs) }
}

/** Janela do `special`: 1 a 14 dias, sempre no futuro do aceite. */
export function specialWindowError (opensAt, closesAt) {
  const a = +at(opensAt)
  const b = +at(closesAt)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'WAR_WINDOW_INVALID'
  const days = (b - a) / DAY
  const { min, max } = FORMATS.special.windowDays
  if (days < min || days > max) return 'WAR_WINDOW_INVALID'
  return null
}

export const settleDueAt = (endedAt) => new Date(+at(endedAt) + SETTLE_GRACE_MS)

/** R15 — mod ainda pode cancelar uma guerra `ended`. Mesma janela do settle. */
export const isContestable = (endedAt, now = new Date()) => +at(now) < +settleDueAt(endedAt)

/**
 * §7 — `skirmish` morre 15 min depois de a live cair. Não existe evento
 * `stream.offline` no vocabulário (docs/EVENTOS.md), então o sinal de live é o
 * último `watch.tick` do canal: é o heartbeat que a fase 03 já grava.
 */
export const isOfflineFor = (lastLiveAt, now = new Date(), grace = OFFLINE_GRACE_MS) =>
  lastLiveAt == null || +at(now) - +at(lastLiveAt) > grace
