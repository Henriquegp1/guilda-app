/**
 * Ciclo de vida da temporada (§6.2) como função pura do relógio:
 *
 *   scheduled ─(starts_at)─> active ─(ends_at)─> freezing ─(+1h)─> closed ─(+30d)─> archived
 *
 * Tudo em UTC (R10). O job só lê `dueStatus` e aplica; a decisão de quando virar
 * não mora em SQL espalhado.
 */

export const SEASON_DAYS = 90          // §6.1 — vive em dados, este é só o default
export const FREEZE_MS = 60 * 60_000   // 1 hora de apuração
export const ARCHIVE_MS = 30 * 86_400_000

const ms = (v) => +new Date(v)
const day = 86_400_000

/** Status que a temporada deveria ter agora. Igual ao atual = nada a fazer. */
export function dueStatus (season, now = new Date()) {
  const t = ms(now)
  switch (season.status) {
    case 'scheduled': return t >= ms(season.starts_at) ? 'active' : 'scheduled'
    case 'active': return t >= ms(season.ends_at) ? 'freezing' : 'active'
    case 'freezing': return t >= ms(season.ends_at) + FREEZE_MS ? 'closed' : 'freezing'
    case 'closed':
      return season.closed_at && t >= ms(season.closed_at) + ARCHIVE_MS ? 'archived' : 'closed'
    default: return season.status
  }
}

/** R7 — janela semiaberta: o instante `ends_at` já pertence à temporada seguinte. */
export const inSeason = (at, season) =>
  ms(at) >= ms(season.starts_at) && ms(at) < ms(season.ends_at)

/** R9 — a seguinte começa exatamente onde a anterior terminou. */
export function nextWindow (prev, days = SEASON_DAYS) {
  const number = Number(prev.number) + 1
  return {
    number,
    name: `Temporada ${number}`,
    starts_at: new Date(ms(prev.ends_at)),
    ends_at: new Date(ms(prev.ends_at) + days * day),
  }
}

/**
 * `ends_at` de um encerramento antecipado. `season_window_ck` exige janela maior
 * que 7 dias, então fechar no dia 2 empurra a apuração para o mínimo legal —
 * é o preço de deixar a regra no banco em vez de no app.
 */
export const earlyEnd = (season, now = new Date()) =>
  new Date(Math.max(ms(now), ms(season.starts_at) + 7 * day + 1000))
