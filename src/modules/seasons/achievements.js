/**
 * Catálogo de conquistas (§7) e os critérios como função pura das estatísticas
 * da guilda. Sem banco: quem coleta as estatísticas é o index.js.
 *
 * `rarity` é obrigatória — a fase 07 só anuncia `epic` e `legendary` no chat.
 */
import { MAX_LEVEL } from '../xp/curve.js'   // D4: o teto vem da fase 03, nunca hardcodado aqui

export const RARITIES = ['common', 'rare', 'epic', 'legendary']

export const ACHIEVEMENTS = {
  first_blood: {
    code: 'first_blood',
    name: 'Primeiro Sangue',
    description: 'Primeira guilda do canal a vencer um evento na temporada',
    rarity: 'epic',
    scope: 'seasonal',
    target: null,                 // gatilho único, sem meta numérica
    from: ['event.win'],
    retroactive: false,           // §7: sazonal, não faz backfill
  },
  army: {
    code: 'army',
    name: 'Exercito',
    description: 'Chegar a 20 membros',
    rarity: 'rare',
    scope: 'permanent',
    target: 20,                   // §7: baixou de 30 para 20 (Nv.20, ~3,5 meses)
    from: ['member.joined'],
    retroactive: true,
  },
  immortals: {
    code: 'immortals',
    name: 'Imortais',
    description: 'Subir ao podio em 3 temporadas, nao necessariamente consecutivas',
    rarity: 'legendary',
    scope: 'permanent',
    target: 3,
    from: ['season.ended'],
    retroactive: true,
  },
  dominators: {
    code: 'dominators',
    name: 'Dominadores',
    description: 'Somar 100 vitorias de evento no tempo de vida da guilda',
    rarity: 'legendary',
    scope: 'permanent',
    target: 100,                  // soma entre temporadas, não zera na virada
    from: ['event.win'],
    retroactive: true,
  },
  legendary: {
    code: 'legendary',
    name: 'Lendarios',
    description: 'Atingir o nivel maximo da progressao',
    rarity: 'legendary',
    scope: 'permanent',
    target: MAX_LEVEL,
    from: ['guild.level_up'],
    retroactive: true,
  },
}

/** Eventos que acordam o handler de conquistas. */
export const TRIGGER_TYPES = [...new Set(
  Object.values(ACHIEVEMENTS).flatMap((a) => a.from))]

const int = (v) => Math.max(0, Math.trunc(Number(v)) || 0)

/** Progresso atual de cada conquista a partir das estatísticas da guilda. */
export const CURRENT = {
  first_blood: (s) => (s.first_win_of_season ? 1 : 0),
  army: (s) => int(s.members),
  immortals: (s) => int(s.podiums),
  dominators: (s) => int(s.wins),
  legendary: (s) => int(s.level),
}

export function evaluate (code, stats = {}) {
  const a = ACHIEVEMENTS[code]
  if (!a) throw new Error(`conquista desconhecida: ${code}`)
  const current = CURRENT[code](stats)
  return {
    code,
    name: a.name,
    rarity: a.rarity,
    scope: a.scope,
    current,
    target: a.target,
    unlocked: a.target == null ? current > 0 : current >= a.target,
  }
}

export const evaluateAll = (stats) => Object.keys(ACHIEVEMENTS).map((c) => evaluate(c, stats))
