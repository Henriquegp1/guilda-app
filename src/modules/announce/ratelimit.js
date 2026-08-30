/**
 * Controle de spam da §6, como função pura. O relógio é injetado (`now` em ms):
 * nada aqui chama Date.now(), é o que torna os limites exatos testáveis.
 *
 * Ordem da §6: quiet/mute/offline → cooldown do tipo → agregação → teto horário
 * → rajada/espaçamento.
 */

export const SPACING_MS = 20_000        // §6, espaçamento mínimo entre dois anúncios
export const BURST_N = 3                // §6, rajada
export const BURST_MS = 60_000
export const HOUR_MS = 3_600_000
export const AGG_WINDOW_MS = 300_000    // §6, janela de agregação
export const AGG_TRIGGER = 3            // R15
export const AGG_MAX = 10               // §6, envia ao atingir 10
export const DEFER_MAX_MS = 60_000      // §3, prioridade alta é adiada até 60 s
export const TTL_MS = 600_000           // R12

const suprimir = (motivo) => ({ acao: 'suprimir', motivo })

/** HH:MM local no fuso do canal. Determinístico dado (now, tz). */
export function localHm (now, timezone) {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
  })
  return f.format(new Date(now))
}

/** Quiet hours com virada de meia-noite (22:00–06:00 é válido). */
export function inQuietHours (now, { from, to, timezone }) {
  if (!from || !to) return false
  const hm = localHm(now, timezone)
  const a = from.slice(0, 5)
  const b = to.slice(0, 5)
  return a <= b ? (hm >= a && hm < b) : (hm >= a || hm < b)
}

/**
 * @param state.priority      'alta' | 'media' | 'baixa'
 * @param state.onCooldown    'agrega' | 'descarta' | 'ultimo' (catálogo)
 * @param state.cooldownS     cooldown do tipo, em segundos
 * @param state.hourlyCap     teto horário do canal (4–20)
 * @param state.sentAt        epochs (ms) dos anúncios já enviados no canal, qualquer ordem
 * @param state.lastTypeAt    epoch (ms) do último anúncio deste tipo, ou null
 * @param state.aggWindowStart epoch (ms) do início da janela de agregação aberta, ou null
 * @param state.mutedUntil    epoch (ms) ou null
 * @param state.quiet         { from, to, timezone } ou null
 * @param state.offline       boolean
 * @returns {{acao:'enviar'|'agregar'|'suprimir', motivo:string, notBefore?:number}}
 */
export function decide (state, now) {
  const {
    priority, onCooldown, cooldownS, hourlyCap = 12,
    sentAt = [], lastTypeAt = null, aggWindowStart = null,
    mutedUntil = null, quiet = null, offline = false,
  } = state

  // R11: mute/quiet/offline descartam. Nada acumula para explodir na volta.
  if (offline) return suprimir('offline')
  if (mutedUntil && mutedUntil > now) return suprimir('muted')
  if (quiet && inQuietHours(now, quiet)) return suprimir('quiet_hours')

  // Janela já aberta: entra nela independentemente do cooldown.
  if (aggWindowStart !== null && now - aggWindowStart < AGG_WINDOW_MS) {
    return { acao: 'agregar', motivo: 'aggregate_window', notBefore: aggWindowStart + AGG_WINDOW_MS }
  }

  let motivo = 'ok'
  if (lastTypeAt !== null && now - lastTypeAt < cooldownS * 1000) {
    if (onCooldown === 'agrega') return { acao: 'agregar', motivo: 'cooldown', notBefore: now + AGG_WINDOW_MS }
    if (onCooldown === 'descarta') return suprimir('cooldown')
    motivo = 'supersede'   // R16: colapsa para o último; o anterior vira superseded
  }

  const recent = [...sentAt].sort((a, b) => a - b)
  const inHour = recent.filter(t => now - t < HOUR_MS)
  const inBurst = recent.filter(t => now - t < BURST_MS)
  const last = recent[recent.length - 1]

  let notBefore = now
  const defer = (until, why) => {
    if (until <= now) return null
    // R8: teto horário estourado descarta média/baixa na hora; alta espera até 60 s.
    if (priority !== 'alta' && why === 'hourly_cap') return suprimir(why)
    if (until - now > DEFER_MAX_MS) return suprimir(why)
    notBefore = Math.max(notBefore, until)
    return null
  }

  if (inHour.length >= hourlyCap) {
    const s = defer(inHour[inHour.length - hourlyCap] + HOUR_MS, 'hourly_cap')
    if (s) return s
  }
  if (inBurst.length >= BURST_N) {
    const s = defer(inBurst[inBurst.length - BURST_N] + BURST_MS, 'burst')
    if (s) return s
  }
  if (last !== undefined) {
    const s = defer(last + SPACING_MS, 'spacing')
    if (s) return s
  }

  return { acao: 'enviar', motivo, notBefore }
}
