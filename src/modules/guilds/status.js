import { conflict } from '../../core/errors.js'

/**
 * Máquina de status da fase 01. `overflow` entra nas origens porque a fase 03 a
 * produz e uma guilda em overflow continua moderável como uma ativa.
 * Ban não tem `unban` de um clique (R13): sair de `banned` é PATCH explícito de mod.
 */
export const TRANSITIONS = {
  approve: { from: ['pending'], to: 'active', code: 'GUILD_NOT_PENDING' },
  reject: { from: ['pending'], to: 'suspended', code: 'GUILD_NOT_PENDING' },
  suspend: { from: ['pending', 'active', 'overflow'], to: 'suspended', code: 'GUILD_ALREADY_SUSPENDED' },
  unsuspend: { from: ['suspended'], to: 'active', code: 'GUILD_NOT_SUSPENDED' },
  ban: { from: ['awaiting', 'pending', 'active', 'overflow', 'suspended'], to: 'banned', code: 'GUILD_ALREADY_BANNED' },
  resubmit: { from: ['suspended'], to: 'pending', code: 'GUILD_NOT_REJECTED' },
}

export function nextStatus (action, from) {
  const t = TRANSITIONS[action]
  if (!t) throw new Error(`transição desconhecida: ${action}`)
  if (!t.from.includes(from)) throw conflict(t.code, `guilda em '${from}' não aceita '${action}'`)
  return t.to
}
