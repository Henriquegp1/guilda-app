/**
 * Curva de níveis e desbloqueios (fase 03 §5 e §6). Puro: sem banco, sem I/O.
 *
 *   XP_total(N) = 250 · (N − 1) · N        XP_do_nivel(N) = 500 · (N − 1)
 *
 * Custo do nível é linear, o acumulado é quadrático. Nv.50 é o teto: o XP
 * continua subindo acima de 612.500 (histórico e fase 04), o nível não.
 */

export const MAX_LEVEL = 50

const clamp = (n) => Math.min(Math.max(Math.trunc(n) || 1, 1), MAX_LEVEL)

/** XP acumulado necessário para estar no nível N. */
export const xpForLevel = (n) => 250 * (clamp(n) - 1) * clamp(n)

/** Custo isolado do nível N (do N−1 para o N). */
export const xpOfLevel = (n) => 500 * (clamp(n) - 1)

/** Maior N com xpForLevel(N) ≤ xp (R9). 50 níveis: laço exato bate fórmula com sqrt. */
export function levelForXp (xp) {
  const total = Number(xp) || 0
  if (total <= 0) return 1
  for (let n = MAX_LEVEL; n > 1; n--) if (xpForLevel(n) <= total) return n
  return 1
}

/** XP que falta para o próximo nível. 0 no teto. */
export const xpToNext = (xp) => {
  const next = levelForXp(xp) + 1
  return next > MAX_LEVEL ? 0 : xpForLevel(next) - (Number(xp) || 0)
}

/** Vagas por faixa de nível (§6). guild.member_limit é derivado, nunca editado à mão. */
const LIMITS = [[1, 10], [5, 12], [10, 15], [15, 17], [20, 20], [25, 22],
  [30, 25], [35, 28], [40, 32], [45, 36], [50, 40]]

export function memberLimitForLevel (n) {
  const level = clamp(n)
  let limit = 10
  for (const [from, vagas] of LIMITS) if (level >= from) limit = vagas
  return limit
}

/**
 * Desbloqueios por nível (§6). Capacidade e cosmético, nunca poder (R15).
 * A chave é o contrato com a fase 06 (assets) e com o painel; o nível é o gatilho.
 */
export const UNLOCKS = {
  1: ['emblem_base', 'color_default', 'description_140'],
  3: ['description_280'],
  5: ['palette_6'],
  8: ['motto'],
  10: ['frame_bronze', 'color_special', 'banner_custom'],
  12: ['xp_history'],
  15: ['frame_silver'],
  18: ['member_badge'],
  20: ['palette_12', 'banner_animated'],
  25: ['frame_gold'],
  30: ['banner_frame', 'guild_emote'],
  35: ['frame_platinum'],
  40: ['color_gradient', 'banner_glow'],
  45: ['frame_diamond'],
  50: ['frame_legendary', 'color_lv50', 'banner_signed'],
}

/** Chaves desbloqueadas em (from, to]. Vazio quando to ≤ from (queda não desbloqueia). */
export function unlocksBetween (from, to) {
  const keys = []
  for (let n = Number(from) + 1; n <= Number(to); n++) keys.push(...(UNLOCKS[n] ?? []))
  return keys
}

export const unlocksUpTo = (level) => unlocksBetween(0, clamp(level))
