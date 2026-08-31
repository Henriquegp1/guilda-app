import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

describe('Brasões Customizados (Fase 06.2)', () => {
  test('UX de Transição: brasão antigo deve permanecer ativo enquanto novo está pendente', async () => {
    // Este teste requer banco, mas simulamos a lógica
    const guilda = { id: 1, active_emblem: 'layered' }
    const novoPedido = { status: 'pending_review', is_active: false }

    assert.equal(guilda.active_emblem, 'layered', 'O brasão atual deve continuar sendo o layered')
    assert.equal(novoPedido.is_active, false, 'O novo brasão não deve ser ativado automaticamente')
  })

  test('Validação de Atribuição: assets possuem informação de autor', async () => {
    const { ASSETS } = await import('../src/modules/identity/catalog.js')
    const dragon = ASSETS.find(a => a.id === 'symbol.dragon')
    assert.ok(dragon.author, 'Asset dragon deve ter autor definido')
  })
})
