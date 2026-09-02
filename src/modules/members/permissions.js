/**
 * A matriz da seção 4 de docs/fase-02-membros.md, como dado.
 *
 * Regra única por trás dela: ninguém age sobre igual ou superior (R7), e ninguém
 * cria alguém do próprio nível (R8). Broadcaster/mod do canal atua por cima de
 * qualquer guilda e é mapeado para 'lider' pelo handler — a única linha da matriz
 * em que ele difere do líder ("sair") não se aplica a quem não é membro.
 */

/** Escada de cargos, do menor para o maior (R9). */
export const ROLES = ['vassalo', 'comandante', 'sub-lider', 'lider']

export const rank = (role) => ROLES.indexOf(role)

/**
 * min    = cargo mínimo do ator.
 * max    = cargo máximo do ator (só "sair": líder precisa transferir antes, R17).
 * target = 'below' exige alvo estritamente inferior ao ator (R7).
 */
export const ACTIONS = {
  members_view:        { min: 'vassalo' },
  requests_view:       { min: 'comandante' },
  leave:               { min: 'vassalo', max: 'sub-lider' },
  invite_create:       { min: 'comandante' },
  invite_revoke_own:   { min: 'comandante' },
  invite_revoke_any:   { min: 'sub-lider' },
  request_approve:     { min: 'sub-lider' },
  request_reject:      { min: 'sub-lider' },
  kick:                { min: 'sub-lider', target: 'below' },
  promote:             { min: 'sub-lider', target: 'below' },
  demote:              { min: 'sub-lider', target: 'below' },
  text_edit:           { min: 'sub-lider' },
  war_declare:         { min: 'sub-lider' },
  join_mode_change:    { min: 'sub-lider' },
  leadership_transfer: { min: 'lider' },
  disband:             { min: 'lider' },
}

/** Código de erro da negação, ou null se permitido. */
export function denyReason (role, action, targetRole = null) {
  const spec = ACTIONS[action]
  if (!spec) throw new Error(`ação desconhecida na matriz: ${action}`)
  if (rank(role) < 0) return 'FORBIDDEN_ROLE'
  if (rank(role) < rank(spec.min)) return 'FORBIDDEN_ROLE'
  if (spec.max && rank(role) > rank(spec.max)) return 'FORBIDDEN_ROLE'
  if (spec.target === 'below') {
    if (rank(targetRole) < 0) return 'TARGET_NOT_MEMBER'
    if (rank(targetRole) >= rank(role)) return 'CANNOT_TARGET_HIGHER_ROLE'
  }
  return null
}

export const can = (role, action, targetRole = null) =>
  denyReason(role, action, targetRole) === null

export const nextRole = (role) => ROLES[rank(role) + 1] ?? null
export const prevRole = (role) => (rank(role) > 0 ? ROLES[rank(role) - 1] : null)

/**
 * R7/R8/R9/R10 num lugar só: pode `actorRole` mover `targetRole` para `toRole`?
 * Retorna o código de erro ou null.
 */
export function roleChangeError (actorRole, targetRole, toRole) {
  if (rank(toRole) < 0 || rank(targetRole) < 0) return 'INVALID_ROLE_TRANSITION'
  // Único caminho para lider é a transferência de liderança (R19).
  if (toRole === 'lider') return 'INVALID_ROLE_TRANSITION'
  // Um degrau por vez, e nunca para o mesmo cargo (R9, R10).
  if (Math.abs(rank(toRole) - rank(targetRole)) !== 1) return 'INVALID_ROLE_TRANSITION'

  const up = rank(toRole) > rank(targetRole)
  const denied = denyReason(actorRole, up ? 'promote' : 'demote', targetRole)
  if (denied) return denied
  // R8: ninguém promove ao próprio nível.
  if (up && rank(toRole) >= rank(actorRole)) return 'CANNOT_PROMOTE_TO_OWN_ROLE'
  return null
}
