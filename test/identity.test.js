import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSETS, BY_ID, CATALOG_VERSION, FALLBACK, LAYERS, PAID_EFFECTS,
  applyFallbacks, canonicalJson, defaultEmblem, emblemHash, priceOfAsset, validateEmblem,
} from '../src/modules/identity/catalog.js'
import {
  SKU_BITS, creditBalance, creditLots, planPayment, skuPrice,
} from '../src/modules/identity/economy.js'

const byLayer = (layer) => ASSETS.filter(a => a.layer === layer)
const count = (layer, tier) => byLayer(layer).filter(a => a.tier === tier).length
const withRevoked = (id, fn) => {
  const a = BY_ID.get(id)
  const before = a.status
  a.status = 'revoked'
  try { fn() } finally { a.status = before }
}

// ------------------------------------------------------------------ catálogo

describe('catálogo', () => {
  test('a composição de cada camada bate com a tabela do §3', () => {
    assert.deepEqual(
      LAYERS.map(l => [count(l, 'free'), count(l, 'level'), count(l, 'paid')]),
      [
        [4, 3, 1],    // shape
        [5, 5, 2],    // background
        [6, 8, 2],    // palette
        [4, 2, 1],    // border  (3 desenhadas + border.none)
        [18, 18, 4],  // symbol
        [1, 2, 4],    // effect  (effect.none é grátis e obrigatório)
      ])
  })

  test('8.640 combinações montáveis só com peças grátis (§3)', () => {
    const combos = LAYERS.reduce((n, l) => n * count(l, 'free'), 1)
    assert.equal(combos, 8640)
  })

  test('cada camada tem exatamente um fallback, grátis e imutável', () => {
    for (const layer of LAYERS) {
      const fbs = byLayer(layer).filter(a => a.isFallback)
      assert.equal(fbs.length, 1, `camada ${layer}`)
      assert.equal(fbs[0].tier, 'free')
      assert.equal(fbs[0].id, FALLBACK[layer])
    }
  })

  test('todo id é {layer}.{slug} estável, sem duplicata', () => {
    assert.equal(new Set(ASSETS.map(a => a.id)).size, ASSETS.length)
    for (const a of ASSETS) {
      const prefix = a.layer === 'background' ? 'bg' : a.layer
      assert.ok(a.id.startsWith(`${prefix}.`), a.id)
    }
  })
})

// ------------------------------------------------------------ validação (R1..R3)

describe('validação do brasão contra o catálogo', () => {
  const full = (over = {}) => ({ ...defaultEmblem(), ...over })

  test('brasão padrão (só fallbacks) é válido sem nível e sem entitlement', () => {
    assert.deepEqual(validateEmblem(defaultEmblem()), [])
    assert.equal(defaultEmblem().catalog_version, CATALOG_VERSION)
  })

  test('camada faltando → MISSING_LAYER na camada certa (R1)', () => {
    const { symbol, ...sem } = full()
    assert.deepEqual(validateEmblem(sem), [{ layer: 'symbol', code: 'MISSING_LAYER' }])
  })

  test('id inexistente ou de outra camada → UNKNOWN_ASSET (R1)', () => {
    assert.deepEqual(validateEmblem(full({ symbol: 'symbol.nao_existe' })),
      [{ layer: 'symbol', id: 'symbol.nao_existe', code: 'UNKNOWN_ASSET' }])
    assert.deepEqual(validateEmblem(full({ border: 'symbol.sword' })),
      [{ layer: 'border', id: 'symbol.sword', code: 'UNKNOWN_ASSET' }])
  })

  test('asset revoked é recusado mesmo com entitlement (R1)', () => {
    withRevoked('symbol.dragon', () => {
      const v = validateEmblem(full({ symbol: 'symbol.dragon' }),
        { level: 99, entitlements: new Set(['symbol.dragon']) })
      assert.deepEqual(v, [{ layer: 'symbol', id: 'symbol.dragon', code: 'ASSET_REVOKED' }])
    })
  })

  test('asset de nível exige nível da guilda, nunca Bits (R3, §7)', () => {
    const layers = full({ symbol: 'symbol.cerberus' })   // unlock_level 20
    assert.deepEqual(validateEmblem(layers, { level: 19 }),
      [{ layer: 'symbol', id: 'symbol.cerberus', code: 'ASSET_LOCKED_BY_LEVEL', required_level: 20 }])
    assert.deepEqual(validateEmblem(layers, { level: 20 }), [])
    // ter "comprado" não destrava: entitlement é irrelevante para tier level.
    assert.equal(validateEmblem(layers, { level: 1, entitlements: new Set(['symbol.cerberus']) }).length, 1)
  })

  test('asset pago exige entitlement da guilda (R2)', () => {
    const layers = full({ symbol: 'symbol.dragon', effect: 'effect.flames' })
    assert.deepEqual(validateEmblem(layers).map(v => v.code), ['ASSET_NOT_OWNED', 'ASSET_NOT_OWNED'])
    assert.deepEqual(validateEmblem(layers, { entitlements: new Set(['symbol.dragon', 'effect.flames']) }), [])
  })

  test('violações acumulam por camada, uma por camada', () => {
    const v = validateEmblem({ shape: 'shape.wyvern', palette: 'palette.royal_gold' })
    assert.equal(v.length, 6)
    assert.deepEqual(v.map(x => x.layer), LAYERS)
  })

  test('R10 — revoked cai no fallback grátis da camada', () => {
    withRevoked('effect.flames', () => {
      const out = applyFallbacks({ ...defaultEmblem(), effect: 'effect.flames', symbol: 'lixo' })
      assert.equal(out.effect, FALLBACK.effect)
      assert.equal(out.symbol, FALLBACK.symbol)
      assert.deepEqual(validateEmblem(out), [])
    })
  })
})

// ------------------------------------------------------------------ dedup

describe('dedup por hash do JSON', () => {
  const a = defaultEmblem()
  const reordered = Object.fromEntries(Object.entries(a).reverse())

  test('mesmo brasão em qualquer ordem de chave → mesmo hash', () => {
    assert.equal(emblemHash(a), emblemHash(reordered))
  })

  test('uma camada diferente → hash diferente', () => {
    assert.notEqual(emblemHash(a), emblemHash({ ...a, symbol: 'symbol.wolf' }))
  })

  test('canônico imita jsonb::text: chaves por tamanho, separador ", " e ": "', () => {
    assert.equal(canonicalJson({ bb: 1, a: 'x', ccc: 2 }), '{"a": "x", "bb": 1, "ccc": 2}')
    assert.match(canonicalJson(a), /^\{"v": 1, "shape": /)
  })
})

// ----------------------------------------------------------------- economia

describe('preços (§6)', () => {
  test('a tabela de SKUs é exatamente a do doc', () => {
    assert.deepEqual(SKU_BITS, {
      'guild.rename': 500, 'guild.tag': 300, 'emblem.slot': 250, 'effect.bundle': 1000,
    })
    assert.equal(skuPrice('asset.symbol.dragon'), 300)
    assert.equal(skuPrice('asset.effect.flames'), 400)
    assert.equal(skuPrice('asset.shape.wyvern'), 200)
    assert.equal(skuPrice('asset.bg.nebula'), 200)
    assert.equal(skuPrice('coisa.inventada'), null)
  })

  test('TRAVA: asset travado por nível não tem preço em Bits (§7)', () => {
    for (const a of ASSETS.filter(a => a.tier === 'level')) {
      assert.equal(priceOfAsset(a.id), null, a.id)
      assert.equal(skuPrice(`asset.${a.id}`), null, a.id)
      assert.equal(a.price, null, a.id)
    }
    for (const a of ASSETS.filter(a => a.tier === 'paid')) {
      assert.equal(a.unlockLevel, null, `${a.id} não pode ter nível e preço`)
    }
    for (const a of ASSETS.filter(a => a.tier === 'free')) assert.equal(priceOfAsset(a.id), null, a.id)
  })

  test('asset revogado deixa de ser vendável', () => {
    withRevoked('symbol.phoenix', () => assert.equal(priceOfAsset('symbol.phoenix'), null))
  })

  test('nada vendável fora da coluna "Bits compram" do §7', () => {
    const cosmetic = new Set(LAYERS)
    for (const sku of Object.keys(SKU_BITS)) {
      assert.ok(['guild.rename', 'guild.tag', 'emblem.slot', 'effect.bundle'].includes(sku), sku)
    }
    for (const a of ASSETS.filter(a => a.tier === 'paid')) assert.ok(cosmetic.has(a.layer), a.id)
    assert.equal(PAID_EFFECTS.length, 4)             // pacote = 3 dos 4
  })
})

describe('crédito de identidade (§8, R20)', () => {
  const day = 864e5
  const now = new Date('2026-01-01T00:00:00Z')
  const lot = (id, delta, plusDays) => ({
    id, delta_bits: delta, expires_at: new Date(+now + plusDays * day).toISOString(),
  })

  test('lote expirado não conta no saldo', () => {
    const rows = [lot(1, 500, -1), lot(2, 300, 10)]
    assert.equal(creditBalance(rows, now), 300)
  })

  test('consumo é imputado FIFO por expires_at', () => {
    const rows = [lot(1, 500, 5), lot(2, 300, 60), { id: 3, delta_bits: -200, expires_at: null }]
    assert.deepEqual(creditLots(rows, now).map(l => [l.id, l.remaining]), [[1, 300], [2, 300]])
  })

  test('crédito de 100% cobre um rename inteiro, sem Bits', () => {
    const lots = creditLots([lot(1, 500, 180)], now)
    assert.deepEqual(planPayment(SKU_BITS['guild.rename'], lots),
      { creditUsed: 500, bitsDue: 0, allocations: [{ lotId: 1, amount: 500 }] })
  })

  test('crédito parcial: consome tudo e o resto vai em Bits', () => {
    const lots = creditLots([lot(1, 120, 5), lot(2, 100, 60)], now)
    const plan = planPayment(300, lots)
    assert.deepEqual(plan.allocations, [{ lotId: 1, amount: 120 }, { lotId: 2, amount: 100 }])
    assert.equal(plan.creditUsed, 220)
    assert.equal(plan.bitsDue, 80)
  })

  test('sem use_credit a compra é 100% Bits', () => {
    const lots = creditLots([lot(1, 500, 180)], now)
    assert.deepEqual(planPayment(250, lots, { useCredit: false }),
      { creditUsed: 0, bitsDue: 250, allocations: [] })
  })
})

// ------------------------------------------------------------------ Postgres

describe('paridade com o banco', { skip: !process.env.DATABASE_URL }, () => {
  test('emblemHash reproduz a coluna gerada de guild_emblem', async () => {
    const { query, pool } = await import('../src/core/db.js')
    const layers = { ...defaultEmblem(), symbol: 'symbol.dragon', effect: 'effect.flames' }
    const { rows } = await query(
      `SELECT encode(sha256($1::jsonb::text::bytea), 'hex') AS h`, [JSON.stringify(layers)])
    assert.equal(rows[0].h, emblemHash(layers))
    await pool.end()
  })
})
