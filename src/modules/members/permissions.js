/**
 * A matriz da seção 4 de docs/fase-02-membros.md, como dado.
 *
 * Regra única por trás dela: ninguém age sobre igual ou superior (R7), e ninguém
 * cria alguém do próprio nível (R8). Broadcaster/mod do canal atua por cima de
 * qualquer guilda e é mapeado para 'leader' pelo handler — a única linha da matriz
 * em que ele difere do líder ("sair") não se aplica a quem não é membro.
 */

/** Escada de cargos, do menor para o maior (R9). */
export const ROLES = ['recruit', 'member', 'veteran', 'officer', 'leader']

export const rank = (role) => ROLES.indexOf(role)

/**
 * min    = cargo mínimo do ator.
 * max    = cargo máximo do ator (só "sair": líder precisa transferir antes, R17).
 * target = 'below' exige alvo estritamente inferior ao ator (R7).
 */
export const ACTIONS = {
  members_view:        { min: 'recruit' },
  requests_view:       { min: 'veteran' },
  leave:               { min: 'recruit', max: 'officer' },
  invite_create:       { min: 'veteran' },
  invite_revoke_own:   { min: 'veteran' },
  invite_revoke_any:   { min: 'officer' },
  request_approve:     { min: 'officer' },
  request_reject:      { min: 'officer' },
  kick:                { min: 'officer', target: 'below' },
  promote:             { min: 'officer', target: 'below' },
  demote:              { min: 'officer', target: 'below' },
  text_edit:           { min: 'officer' },
  war_declare:         { min: 'officer' },
  join_mode_change:    { min: 'leader' },
  leadership_transfer: { min: 'leader' },
  disband:             { min: 'leader' },
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
  // Único caminho para leader é a transferência de liderança (R19).
  if (toRole === 'leader') return 'INVALID_ROLE_TRANSITION'
  // Um degrau por vez, e nunca para o mesmo cargo (R9, R10).
  if (Math.abs(rank(toRole) - rank(targetRole)) !== 1) return 'INVALID_ROLE_TRANSITION'

  const up = rank(toRole) > rank(targetRole)
  const denied = denyReason(actorRole, up ? 'promote' : 'demote', targetRole)
  if (denied) return denied
  // R8: ninguém promove ao próprio nível.
  if (up && rank(toRole) >= rank(actorRole)) return 'CANNOT_PROMOTE_TO_OWN_ROLE'
  return null
}
