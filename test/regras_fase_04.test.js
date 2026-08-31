import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { compareRank } from '../src/modules/seasons/ranking.js'

describe('Regras Rigorosas de Desempate (Fase 04)', () => {
  const g = (o) => ({
    guild_id: 1, prestige: 1000, last_gain_at: '2026-08-30T14:00:00Z',
    created_at: '2026-01-01T00:00:00Z', ...o,
  })

  test('Caso A às 14:00 vs B às 14:05: A deve ocupar posição superior', () => {
    const guildaA = g({ guild_id: 10, last_gain_at: '2026-08-30T14:00:00Z' })
    const guildaB = g({ guild_id: 20, last_gain_at: '2026-08-30T14:05:00Z' })

    // compareRank < 0 significa que o primeiro argumento vem ANTES (posição melhor)
    const resultado = compareRank(guildaA, guildaB)
    assert.ok(resultado < 0, `Guilda A (${guildaA.last_gain_at}) deve vencer Guilda B (${guildaB.last_gain_at})`)
  })

  test('Caso B atinge a pontuação de A depois: A continua na frente', () => {
    const guildaA = g({ guild_id: 10, prestige: 1000, last_gain_at: '2026-08-30T14:00:00Z' })
    const guildaB = g({ guild_id: 20, prestige: 1000, last_gain_at: '2026-08-30T14:05:00Z' })

    assert.ok(compareRank(guildaA, guildaB) < 0)
  })
})
