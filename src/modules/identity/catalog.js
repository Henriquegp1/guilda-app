import { createHash } from 'node:crypto'

/**
 * Catálogo de assets do Emblem Creator (fase 06 §5).
 */

export const CATALOG_VERSION = 3
export const EMBLEM_V = 1

export const LAYERS = ['shape', 'background', 'palette', 'border', 'symbol', 'effect']

/** Fallback obrigatório e imutável por camada — sempre grátis (§5). */
export const FALLBACK = Object.freeze({
  shape: 'shape.heater',
  background: 'bg.solid',
  palette: 'palette.slate',
  border: 'border.none',
  symbol: 'symbol.blank',
  effect: 'effect.none',
})

/** Preço em Bits de um asset pago, por camada (§6). */
export const PAID_PRICE = { symbol: 300, effect: 400, shape: 200, background: 200, palette: 200, border: 200 }

const prefixOf = (layer) => (layer === 'background' ? 'bg' : layer)
const mk = (layer, tier, slug, extra) => ({
  id: `${prefixOf(layer)}.${slug}`,
  layer,
  tier,
  status: 'active',
  price: tier === 'paid' ? PAID_PRICE[layer] : null,
  unlockLevel: null,
  author: 'Game-icons.net', // Default para a v1
  ...extra,
})
const free = (layer, slugs) => slugs.map(s => mk(layer, 'free', s))
const level = (layer, pairs) => pairs.map(([s, lv]) => mk(layer, 'level', s, { unlockLevel: lv }))
const paid = (layer, slugs) => slugs.map(s => mk(layer, 'paid', s))

// 88 assets desenhados + `border.none` e `effect.none`, que são ids reais e não null (§3).
export const ASSETS = [
  ...free('shape', ['heater', 'round', 'square', 'pointed']),
  ...level('shape', [['kite', 5], ['lozenge', 8], ['banner', 12]]),
  ...paid('shape', ['wyvern']),

  ...free('background', ['solid', 'split', 'chevron', 'stripes', 'checker']),
  ...level('background', [['diagonal_split', 3], ['quarters', 5], ['rays', 7], ['scales', 10], ['starfield', 14]]),
  ...paid('background', ['nebula', 'circuit']),

  ...free('palette', ['slate', 'ember', 'forest', 'ocean', 'sand', 'plum']),
  ...level('palette', [['crimson_black', 3], ['gold_navy', 5], ['emerald_ivory', 6], ['violet_ash', 8],
    ['copper_teal', 9], ['frost_steel', 11], ['toxic_lime', 13], ['blood_bone', 15]]),
  ...paid('palette', ['royal_gold', 'void_neon']),

  ...free('border', ['none', 'plain', 'rope', 'beaded']),
  ...level('border', [['laurel', 6], ['chain', 10]]),
  ...paid('border', ['runic']),

  // 18 grátis (§3) — inclui o fallback obrigatório 'blank'
  ...free('symbol', [
    'blank', 'sword', 'shield', 'axe', 'bow', 'dagger', 'hammer', 'spear',
    'mace', 'staff', 'wand', 'torch', 'lantern', 'scroll', 'potion', 'gem', 'key', 'flag',
  ]),
  // 18 desbloqueáveis por nível (§3)
  ...level('symbol', [
    ['eagle', 5], ['wolf', 8], ['bear', 10], ['boar', 12], ['falcon', 15],
    ['cerberus', 20], ['griffin', 22], ['unicorn', 25], ['chimera', 28], ['hydra', 30],
    ['kraken', 32], ['basilisk', 35], ['wyrm', 38], ['colossus', 40], ['titan', 42],
    ['seraph', 45], ['minotaur', 48], ['reaper', 50],
  ]),
  // 4 pagos (§3)
  ...paid('symbol', ['dragon', 'leviathan', 'behemoth', 'phoenix']),

  ...free('effect', ['none']),
  ...level('effect', [['glow', 4], ['smoke', 9]]),
  ...paid('effect', ['flames', 'sparks', 'embers', 'frost']),
].map(a => ({ ...a, isFallback: FALLBACK[a.layer] === a.id, svgSymbolId: a.id.replace('.', '--') }))

export const BY_ID = new Map(ASSETS.map(a => [a.id, a]));
export const asset = (id) => BY_ID.get(id) ?? null
export const PAID_EFFECTS = ASSETS.filter(a => a.layer === 'effect' && a.tier === 'paid').map(a => a.id)

export function priceOfAsset (id) {
  const a = asset(id)
  return a && a.tier === 'paid' && a.status !== 'revoked' ? a.price : null
}

export const defaultEmblem = () => ({ v: EMBLEM_V, catalog_version: CATALOG_VERSION, ...FALLBACK })

export function normalizeLayers (layers = {}) {
  const out = { v: EMBLEM_V, catalog_version: CATALOG_VERSION }
  for (const l of LAYERS) out[l] = layers[l]
  return out
}

export function validateEmblem (layers, { level = 1, entitlements = new Set() } = {}) {
  if (!layers || typeof layers !== 'object') return [{ code: 'INVALID_LAYERS' }]
  const violations = []
  for (const layer of LAYERS) {
    const id = layers[layer]
    if (typeof id !== 'string' || !id) { violations.push({ layer, code: 'MISSING_LAYER' }); continue }
    const a = asset(id)
    if (!a || a.layer !== layer) { violations.push({ layer, id, code: 'UNKNOWN_ASSET' }); continue }
    if (a.status === 'revoked') violations.push({ layer, id, code: 'ASSET_REVOKED' })
    else if (a.tier === 'level' && level < a.unlockLevel) {
      violations.push({ layer, id, code: 'ASSET_LOCKED_BY_LEVEL', required_level: a.unlockLevel })
    } else if (a.tier === 'paid' && !entitlements.has(id)) {
      violations.push({ layer, id, code: 'ASSET_NOT_OWNED' })
    }
  }
  return violations
}

export function applyFallbacks (layers) {
  const out = normalizeLayers(layers)
  for (const layer of LAYERS) {
    const a = asset(out[layer])
    if (!a || a.layer !== layer || a.status === 'revoked') out[layer] = FALLBACK[layer]
  }
  return out
}

export function canonicalJson (obj) {
  const keys = Object.keys(obj).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
  return `{${keys.map(k => `${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`).join(', ')}}`
}

export const emblemHash = (layers) => createHash('sha256').update(canonicalJson(layers)).digest('hex')
const CDN = process.env.EMBLEM_CDN ?? 'https://cdn.example/emblem'
export const renderUrl = (hash, size = 256) => `${CDN}/${hash}/${size}.png`
export const BANNED_EMBLEM = 'emblem.banned'
