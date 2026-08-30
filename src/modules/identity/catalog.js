import { createHash } from 'node:crypto'

/**
 * Catálogo de assets do Emblem Creator (fase 06 §5).
 *
 * O catálogo é DADO DO MÓDULO, não linha de banco: ele é imutável em produção,
 * versionado por inteiro monotônico e lido em todo request de validação. Uma
 * tabela `emblem_asset` seria uma segunda fonte de verdade para o mesmo array.
 *
 * Regras que este arquivo carrega:
 * - id é `{layer}.{slug}`, estável e imutável (`background` usa o prefixo `bg.`).
 * - `status`: active | deprecated | revoked. Nada é removido, só muda de status.
 * - cada camada tem exatamente um fallback, sempre `free` (§5).
 * - TRAVA DE DESIGN (§7): `tier:'level'` NUNCA tem preço. Ver `priceOfAsset`.
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

  ...free('symbol', ['blank', 'sword', 'shield', 'axe', 'hammer', 'bow', 'star', 'crown', 'anchor',
    'leaf', 'flame', 'skull', 'wolf', 'bear', 'fox', 'raven', 'fish', 'gear']),
  ...level('symbol', [['lion', 3], ['tiger', 4], ['eagle', 5], ['serpent', 6], ['scorpion', 7], ['spider', 8],
    ['owl', 9], ['stag', 10], ['boar', 11], ['whale', 12], ['kraken', 13], ['griffin', 14],
    ['unicorn', 15], ['basilisk', 16], ['sphinx', 17], ['chimera', 18], ['hydra', 19], ['cerberus', 20]]),
  ...paid('symbol', ['dragon', 'phoenix', 'leviathan', 'behemoth']),

  ...free('effect', ['none']),
  ...level('effect', [['glow', 4], ['smoke', 9]]),
  ...paid('effect', ['flames', 'sparks', 'embers', 'frost']),
].map(a => ({ ...a, isFallback: FALLBACK[a.layer] === a.id, svgSymbolId: a.id.replace('.', '--') }))

export const BY_ID = new Map(ASSETS.map(a => [a.id, a]))

export const asset = (id) => BY_ID.get(id) ?? null

/** Os 4 efeitos pagos; o pacote (§6) leva 3 deles. */
export const PAID_EFFECTS = ASSETS.filter(a => a.layer === 'effect' && a.tier === 'paid').map(a => a.id)

/**
 * TRAVA DE DESIGN (§7, R3): asset travado por nível não tem preço em Bits.
 * Retorna null para qualquer coisa que não seja `tier:'paid'` — quem chama
 * transforma null em ASSET_NOT_PURCHASABLE. Não existe caminho pago para `level`.
 */
export function priceOfAsset (id) {
  const a = asset(id)
  return a && a.tier === 'paid' && a.status !== 'revoked' ? a.price : null
}

/** Brasão padrão: só fallbacks, custo zero. Toda guilda nasce com ele (R4). */
export const defaultEmblem = () => ({ v: EMBLEM_V, catalog_version: CATALOG_VERSION, ...FALLBACK })

/** Normaliza para as 8 chaves guardadas em `guild_emblem.layers` (§4). */
export function normalizeLayers (layers = {}) {
  const out = { v: EMBLEM_V, catalog_version: CATALOG_VERSION }
  for (const l of LAYERS) out[l] = layers[l]
  return out
}

/**
 * R1/R2/R3 — validação do brasão contra o catálogo. Pura: nada de banco aqui.
 * `entitlements` é um Set de asset ids que a GUILDA possui (R2), `level` é o
 * nível da guilda (R3). Retorna [] quando o brasão é publicável.
 */
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

/** R10 — troca asset revogado (ou inexistente) pelo fallback grátis da camada. */
export function applyFallbacks (layers) {
  const out = normalizeLayers(layers)
  for (const layer of LAYERS) {
    const a = asset(out[layer])
    if (!a || a.layer !== layer || a.status === 'revoked') out[layer] = FALLBACK[layer]
  }
  out.catalog_version = CATALOG_VERSION
  return out
}

/**
 * Serialização canônica idêntica à saída de `jsonb::text` do Postgres: chaves
 * ordenadas por tamanho e depois byte a byte, separadores `", "` e `": "`.
 * É o que faz o hash calculado aqui bater com a coluna gerada
 * `encode(sha256(layers::text::bytea),'hex')` de `guild_emblem` (§4).
 * Só cobre objeto raso de string/number — que é a forma fixa do brasão.
 */
export function canonicalJson (obj) {
  const keys = Object.keys(obj).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
  return `{${keys.map(k => `${JSON.stringify(k)}: ${JSON.stringify(obj[k])}`).join(', ')}}`
}

/** Chave de dedup de render: brasões iguais compartilham arquivo (§4). */
export const emblemHash = (layers) => createHash('sha256').update(canonicalJson(layers)).digest('hex')

const CDN = process.env.EMBLEM_CDN ?? 'https://cdn.example/emblem'

/**
 * STUB de renderização. A entrega real (§4) é um job assíncrono com `resvg`
 * gerando PNG 512/256/112/28 em `emblem/{hash}/{size}.png`. Aqui só devolvemos
 * a URL determinística: ela é função do hash, então o caminho existe antes do
 * job rodar e nada no request path espera render. `render_url` fica NULL no
 * banco até o job publicar; esta função é o contrato dele.
 */
export const renderUrl = (hash, size = 256) => `${CDN}/${hash}/${size}.png`

/** Placeholder de guilda banida (R22). */
export const BANNED_EMBLEM = 'emblem.banned'
