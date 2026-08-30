import { verifyTwitchJwt } from '../../core/auth.js'
import { badRequest } from '../../core/errors.js'
import { priceOfAsset } from './catalog.js'

/**
 * Economia da fase 06 (§6): preços fechados, crédito de identidade, recibo de Bits.
 * Tudo aqui é cosmético ou fricção deliberada — nada nesta tabela altera XP,
 * nível, prestígio, cargo, membros ou resultado de guerra (§7).
 */
export const SKU_BITS = Object.freeze({
  'guild.rename': 500,
  'guild.tag': 300,
  'emblem.slot': 250,
  'effect.bundle': 1000,
})

export const CREDIT_TTL_DAYS = 180
export const IDENTITY_COOLDOWN_DAYS = 30      // R11
export const NAME_RESERVATION_DAYS = 30       // R12, ARQUITETURA §Ciclo de vida
export const IDENTITY_LOCK_DAYS = 7           // R14
export const SLOT_COOLDOWN_H = 24             // §6
export const EMBLEM_EDIT_COOLDOWN_S = 60      // R7
export const ACTIVE_SWAPS_PER_HOUR = 10       // R6
export const MAX_SLOTS = 5                    // R5
export const REPORTS_TO_REVIEW = 3            // R9

export const assetSku = (id) => `asset.${id}`

/** Preço em Bits de um SKU. null = não vendável (inclui asset travado por nível). */
export function skuPrice (sku) {
  if (sku in SKU_BITS) return SKU_BITS[sku]
  if (sku.startsWith('asset.')) return priceOfAsset(sku.slice('asset.'.length))
  return null
}

/**
 * Reconstrói os lotes de crédito vivos a partir do razão `guild_identity_credit`.
 * Emissões são positivas e têm `expires_at`; consumos são negativos. O consumo é
 * imputado FIFO por `expires_at` (R20), então o razão não precisa apontar lote.
 */
export function creditLots (rows, now = new Date()) {
  const lots = rows.filter(r => r.delta_bits > 0)
    .map(r => ({ id: Number(r.id), remaining: r.delta_bits, expiresAt: new Date(r.expires_at) }))
    .sort((a, b) => a.expiresAt - b.expiresAt)

  let spent = rows.reduce((s, r) => s + (r.delta_bits < 0 ? -r.delta_bits : 0), 0)
  for (const lot of lots) {
    const take = Math.min(lot.remaining, spent)
    lot.remaining -= take
    spent -= take
  }
  return lots.filter(l => l.remaining > 0 && l.expiresAt > now)
}

export const creditBalance = (rows, now = new Date()) =>
  creditLots(rows, now).reduce((s, l) => s + l.remaining, 0)

/** R20 — crédito primeiro (FIFO), o resto em Bits. */
export function planPayment (price, lots, { useCredit = true } = {}) {
  const allocations = []
  let left = useCredit ? price : 0
  for (const lot of lots) {
    if (left <= 0) break
    const amount = Math.min(lot.remaining, left)
    allocations.push({ lotId: lot.id, amount })
    left -= amount
  }
  const creditUsed = allocations.reduce((s, a) => s + a.amount, 0)
  return { creditUsed, bitsDue: price - creditUsed, allocations }
}

/**
 * Recibo de Bits da Extensão: JWT HS256 assinado com o mesmo segredo da extensão.
 * O EBS nunca confia no `sku` que o cliente mandou — confere canal, valor e
 * devolve o `transactionId`, que é a chave de idempotência (R18).
 */
export function verifyReceipt (receipt, { channelId, minBits }) {
  if (!receipt) throw badRequest('PURCHASE_INVALID', 'recibo de Bits ausente')

  let claims
  try {
    verifyTwitchJwt(receipt)                                   // assinatura, exp, channel_id
    claims = JSON.parse(Buffer.from(receipt.split('.')[1], 'base64url'))
  } catch {
    throw badRequest('PURCHASE_INVALID', 'recibo de Bits inválido')
  }

  const tx = claims.data?.transactionId
  const bits = claims.data?.product?.cost?.amount
  if (claims.topic !== 'bits_transaction_receipt' || !tx || !Number.isInteger(bits)) {
    throw badRequest('PURCHASE_INVALID', 'recibo de Bits malformado')
  }
  if (String(claims.channel_id) !== String(channelId)) {
    throw badRequest('PURCHASE_INVALID', 'recibo de outro canal')
  }
  if (bits < minBits) throw badRequest('PURCHASE_INVALID', `recibo de ${bits} Bits, esperado ${minBits}`)

  return { transactionId: String(tx), bits, sku: claims.data?.product?.sku ?? null, userId: claims.user_id ?? null }
}
