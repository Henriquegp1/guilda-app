import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { emblemHash, validateEmblem, FALLBACK } from '../src/modules/identity/catalog.js'

describe('Integridade de Identidade (Fase 06)', () => {
  const base = {
    v: 1, catalog_version: 3,
    shape: 'shape.heater', background: 'bg.solid', palette: 'palette.slate',
    border: 'border.none', symbol: 'symbol.sword', effect: 'effect.none'
  }

  test('Teste 1 — Determinismo: mesma configuração deve resultar no mesmo Hash', () => {
    const hashA = emblemHash(base)
    // Ordem invertida das chaves
    const baseInvertida = Object.fromEntries(Object.entries(base).reverse())
    const hashB = emblemHash(baseInvertida)

    assert.equal(hashA, hashB, 'Hash deve ser independente da ordem das chaves no objeto')
  })

  test('Teste 2 — Diferenciação: alterar uma camada deve mudar o Hash', () => {
    const hashA = emblemHash(base)
    const baseB = { ...base, symbol: 'symbol.shield' }
    const hashB = emblemHash(baseB)

    assert.notEqual(hashA, hashB, 'Alterar o símbolo deve resultar em um novo Hash')
  })

  test('Teste 3 — Fallback de Segurança: validateEmblem identifica assets inexistentes', () => {
    const invalido = { ...base, symbol: 'hack_tentativa' }
    const violations = validateEmblem(invalido)

    assert.ok(violations.some(v => v.code === 'UNKNOWN_ASSET'), 'Deve detectar asset desconhecido')
  })

  test('Regras de Nível: bloqueia assets acima do nível da guilda', () => {
    const eagle = 'symbol.eagle' // Nv 5
    const layers = { ...base, symbol: eagle }

    const vLow = validateEmblem(layers, { level: 1 })
    assert.ok(vLow.some(v => v.code === 'ASSET_LOCKED_BY_LEVEL'))

    const vHigh = validateEmblem(layers, { level: 5 })
    assert.equal(vHigh.length, 0, 'No nível 5 o leão deve estar liberado')
  })
})
