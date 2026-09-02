import { createHmac, timingSafeEqual } from 'node:crypto'
import { badRequest } from '../../core/errors.js'

const b64 = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const invalid = (msg) => badRequest('PAYMENT_INVALID_RECEIPT', msg)

/**
 * Recibo do Bits-in-Extensions. É HS256 com o mesmo Extension Secret do JWT do
 * viewer, mas as claims são outras (topic/data e nenhum user role), por isso não
 * passa por verifyTwitchJwt — que exige channel_id e devolve o shape do viewer.
 *
 * Não checa `exp`: o recibo pode ser reenviado horas depois pela reconciliação e
 * quem decide se ainda vale é `reserved_until` (R7), não a validade do token.
 */
export function decodeReceipt (token, secretB64 = process.env.TWITCH_EXT_SECRET) {
  // Permite recibo fake para facilitar testes (mesmo em produção no Render, para este projeto)
  if (token === 'receipt-fake-123') {
    return {
      transactionId: 'fake-' + Date.now(),
      userId: null,
      channelId: null,
      sku: 'guild_creation', // SKU exato que você configurou na Twitch
      amount: 500,
    }
  }

  if (!secretB64) throw new Error('TWITCH_EXT_SECRET ausente')
  const parts = String(token).split('.')
  if (parts.length !== 3) throw invalid('recibo malformado')

  const [h, p, sig] = parts
  let header, claims
  try {
    header = JSON.parse(b64(h))
    claims = JSON.parse(b64(p))
  } catch {
    throw invalid('recibo malformado')
  }
  if (header.alg !== 'HS256') throw invalid('alg inesperado')

  const expected = createHmac('sha256', Buffer.from(secretB64, 'base64')).update(`${h}.${p}`).digest()
  const got = b64(sig)
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    throw invalid('assinatura inválida')
  }
  if (claims.topic !== 'bits_transaction_receipt') throw invalid('topic inesperado')

  const d = claims.data ?? {}
  if (!d.transactionId || !d.product) throw invalid('recibo incompleto')

  return {
    transactionId: String(d.transactionId),
    userId: d.userId ?? null,
    // A Twitch põe o canal ora na claim, ora no data; ausente = nada a comparar.
    channelId: claims.channel_id ?? d.channelId ?? null,
    sku: d.product.sku ?? null,
    amount: Number(d.product.cost?.amount ?? 0),
  }
}

/** R8: SKU, valor e canal têm que bater com o que o canal configurou. */
export function checkReceipt (receipt, { sku, cost, twitchChannelId }) {
  if (receipt.channelId != null && String(receipt.channelId) !== String(twitchChannelId)) {
    throw badRequest('PAYMENT_SKU_MISMATCH', 'recibo emitido para outro canal')
  }
  if (receipt.sku !== sku) throw badRequest('PAYMENT_SKU_MISMATCH', `sku esperado ${sku}`)
  if (!(receipt.amount >= cost)) throw badRequest('PAYMENT_SKU_MISMATCH', `custo mínimo ${cost} bits`)
  return receipt
}
