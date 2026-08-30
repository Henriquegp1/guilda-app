import {
  createHmac, timingSafeEqual, randomBytes,
  createCipheriv, createDecipheriv,
} from 'node:crypto'

export const SIGNATURE_SKEW_S = 300     // §11 anti-replay

/** §4: HMAC-SHA256 sobre `<timestamp>.<corpo bruto>`, hex minúsculo. */
export const sign = (secret, timestamp, body) =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')

/** Durante a rotação assinamos com os dois: `v1=<hex>,v1=<hex>`. */
export const signatureHeader = (secrets, timestamp, body) =>
  secrets.map(s => `v1=${sign(s, timestamp, body)}`).join(',')

const eq = (a, b) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Verifica o header de entrada (POST /announce/mute). Aceita se QUALQUER valor
 * bater com QUALQUER segredo vivo, e rejeita fora da janela de ±300 s.
 */
export function verifySignature ({ header, timestamp, body, secrets, now }) {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Math.floor(now / 1000) - ts) > SIGNATURE_SKEW_S) return false

  const got = String(header ?? '').split(',').map(s => s.trim().replace(/^v1=/, ''))
  return secrets.some(sec => {
    const want = sign(sec, timestamp, body)
    return got.some(g => eq(g, want))
  })
}

export const newSecret = () => randomBytes(32).toString('hex')   // §11: 32 bytes, hex

// --- armazenamento cifrado (announce_secret.secret_enc) --------------------
// O core não expõe chave de app; usamos ANNOUNCE_ENC_KEY (32 bytes hex).
const key = () => {
  const k = process.env.ANNOUNCE_ENC_KEY
  if (!k || k.length !== 64) throw new Error('ANNOUNCE_ENC_KEY ausente ou != 32 bytes hex')
  return Buffer.from(k, 'hex')
}

export function encryptSecret (plain) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct])
}

export function decryptSecret (buf) {
  const b = Buffer.from(buf)
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12))
  d.setAuthTag(b.subarray(12, 28))
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8')
}
