import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  checkDenylist, normalizeForDenylist, parseForm,
  validateColor, validateEmblem, validateName, validateTag, validateText,
} from '../src/modules/guilds/validate.js'
import { nextStatus, TRANSITIONS } from '../src/modules/guilds/status.js'
import { checkReceipt, decodeReceipt } from '../src/modules/guilds/bits.js'

const code = (c) => ({ code: c })

describe('nome (R1)', () => {
  for (const ok of ['Void', 'ab1', 'A'.repeat(24), 'Os Cavaleiros de Ferro', '123']) {
    test(`aceita ${JSON.stringify(ok)}`, () => assert.equal(validateName(ok), ok))
  }

  const ruins = {
    'curto demais': 'ab',
    'longo demais': 'A'.repeat(25),
    'com acento': 'Guilda do Coração',
    'com underscore': 'void_squad',
    'com hífen': 'void-squad',
    'espaço no início': ' Void',
    'espaço no fim': 'Void ',
    'espaço duplo': 'Void  Squad',
    'vazio': '',
    'não é string': 42,
  }
  for (const [caso, valor] of Object.entries(ruins)) {
    test(`rejeita ${caso}`, () =>
      assert.throws(() => validateName(valor), code('GUILD_NAME_INVALID')))
  }
})

describe('TAG (R2)', () => {
  test('normaliza para maiúscula', () => assert.equal(validateTag('void'), 'VOID'))
  test('aceita dígitos', () => assert.equal(validateTag('v01d'), 'V01D'))
  test('aceita 2 e 5 caracteres', () => {
    assert.equal(validateTag('ab'), 'AB')
    assert.equal(validateTag('abcde'), 'ABCDE')
  })
  for (const ruim of ['a', 'abcdef', 'vo d', 'vo-d', 'võid', '', null]) {
    test(`rejeita ${JSON.stringify(ruim)}`, () =>
      assert.throws(() => validateTag(ruim), code('GUILD_TAG_INVALID')))
  }
})

describe('denylist (R4)', () => {
  test('normaliza acento, leetspeak, espaço e caixa', () => {
    assert.equal(normalizeForDenylist('N4-Z1 stá'), 'nazista')
    assert.equal(normalizeForDenylist('4DM1N'), 'admin')
  })
  test('pega o termo escrito em leetspeak', () =>
    assert.throws(() => checkDenylist('4dm1n Squad'), code('GUILD_NAME_FORBIDDEN')))
  test('pega sufixo de termo com 4+ letras', () =>
    assert.throws(() => checkDenylist('Nazistas'), code('GUILD_NAME_FORBIDDEN')))
  test('termo curto só casa inteiro', () => {
    assert.throws(() => checkDenylist('M0D'), code('GUILD_NAME_FORBIDDEN'))
    assert.doesNotThrow(() => checkDenylist('Os Modernos'))
  })
  test('aceita a denylist extra do canal', () => {
    assert.doesNotThrow(() => checkDenylist('Foyth'))
    assert.throws(() => checkDenylist('Foyth', ['foyth']), code('GUILD_NAME_FORBIDDEN'))
  })
  test('nome limpo passa', () => assert.doesNotThrow(() => checkDenylist('Os Cavaleiros')))
})

describe('demais campos (R3)', () => {
  test('cor normalizada para maiúscula', () => assert.equal(validateColor('#9146ff', 'c'), '#9146FF'))
  for (const ruim of ['9146FF', '#914', '#GGGGGG', null]) {
    test(`cor inválida ${JSON.stringify(ruim)}`, () =>
      assert.throws(() => validateColor(ruim, 'c'), code('VALIDATION_ERROR')))
  }
  test('descrição no limite passa, acima falha', () => {
    assert.equal(validateText('x'.repeat(280), 280, 'd'), 'x'.repeat(280))
    assert.throws(() => validateText('x'.repeat(281), 280, 'd'), code('VALIDATION_ERROR'))
  })
  test('null vira null', () => assert.equal(validateText(null, 80, 'm'), null))
  test('emblema fora do catálogo falha; null remove', () => {
    assert.equal(validateEmblem('shield'), 'shield')
    assert.equal(validateEmblem(null), null)
    assert.throws(() => validateEmblem('meu-upload.png'), code('VALIDATION_ERROR'))
  })
})

describe('parseForm', () => {
  test('só devolve o que veio no body', () => {
    assert.deepEqual(parseForm({ tag: 'void' }), { tag: 'VOID' })
    assert.deepEqual(parseForm({}), {})
  })
  test('emblem_preset null é uma remoção, não uma ausência', () => {
    assert.deepEqual(parseForm({ emblem_preset: null }), { emblem_preset: null })
  })
  test('normaliza o formulário inteiro', () => {
    assert.deepEqual(
      parseForm({ name: 'Void Squad', tag: 'vd', color_primary: '#9146ff', motto: 'ok' }),
      { name: 'Void Squad', tag: 'VD', color_primary: '#9146FF', motto: 'ok' })
  })
  test('denylist do canal alcança a TAG', () =>
    assert.throws(() => parseForm({ tag: 'kkk' }), code('GUILD_NAME_FORBIDDEN')))
})

describe('transições de status', () => {
  test('caminho feliz: pending → active', () => assert.equal(nextStatus('approve', 'pending'), 'active'))
  test('rejeitar mantém a guilda viva, suspensa (R12)', () =>
    assert.equal(nextStatus('reject', 'pending'), 'suspended'))
  test('resubmit devolve para a fila', () => assert.equal(nextStatus('resubmit', 'suspended'), 'pending'))
  test('unsuspend volta para active', () => assert.equal(nextStatus('unsuspend', 'suspended'), 'active'))
  test('suspender guilda em overflow funciona (fase 03)', () =>
    assert.equal(nextStatus('suspend', 'overflow'), 'suspended'))

  test('aprovar guilda já ativa → GUILD_NOT_PENDING', () =>
    assert.throws(() => nextStatus('approve', 'active'), code('GUILD_NOT_PENDING')))
  test('aprovar rascunho não pago → GUILD_NOT_PENDING', () =>
    assert.throws(() => nextStatus('approve', 'awaiting'), code('GUILD_NOT_PENDING')))
  test('suspender já suspensa → GUILD_ALREADY_SUSPENDED', () =>
    assert.throws(() => nextStatus('suspend', 'suspended'), code('GUILD_ALREADY_SUSPENDED')))
  test('unsuspend de guilda ativa → GUILD_NOT_SUSPENDED', () =>
    assert.throws(() => nextStatus('unsuspend', 'active'), code('GUILD_NOT_SUSPENDED')))
  test('banir de novo → GUILD_ALREADY_BANNED', () =>
    assert.throws(() => nextStatus('ban', 'banned'), code('GUILD_ALREADY_BANNED')))

  test('nada sai de banned: não existe unban de um clique (R13)', () => {
    for (const action of Object.keys(TRANSITIONS)) {
      assert.throws(() => nextStatus(action, 'banned'), Error, `${action} não deveria aceitar banned`)
    }
  })
  test('ação inexistente é erro de programação, não 4xx', () =>
    assert.throws(() => nextStatus('explode', 'active'), /transição desconhecida/))
})

describe('recibo de Bits (R8)', () => {
  const SECRET = Buffer.from('segredo-de-teste-32-bytes-aqui!!').toString('base64')
  const OUTRO = Buffer.from('outro-segredo-de-32-bytes-aqui!!').toString('base64')
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

  const sign = (claims, secret = SECRET, header = { alg: 'HS256', typ: 'JWT' }) => {
    const body = `${b64(header)}.${b64(claims)}`
    return `${body}.${createHmac('sha256', Buffer.from(secret, 'base64')).update(body).digest('base64url')}`
  }

  const receipt = (over = {}) => sign({
    topic: 'bits_transaction_receipt',
    exp: Math.floor(Date.now() / 1000) + 600,
    channel_id: '123',
    data: {
      transactionId: 'tx-1',
      userId: 'u1',
      product: { sku: 'guild_creation_500', cost: { amount: 500, type: 'bits' } },
      ...over,
    },
  }, over.secret ?? SECRET)

  const expected = { sku: 'guild_creation_500', cost: 500, twitchChannelId: '123' }

  test('extrai transação, sku e valor', () => {
    assert.deepEqual(decodeReceipt(receipt(), SECRET), {
      transactionId: 'tx-1', userId: 'u1', channelId: '123',
      sku: 'guild_creation_500', amount: 500,
    })
  })
  test('rejeita assinatura de outra chave', () =>
    assert.throws(() => decodeReceipt(receipt({ secret: OUTRO }), SECRET), code('PAYMENT_INVALID_RECEIPT')))
  test('rejeita alg none', () => {
    const t = sign({ topic: 'bits_transaction_receipt', data: { transactionId: 'x', product: {} } },
      SECRET, { alg: 'none' })
    assert.throws(() => decodeReceipt(t, SECRET), code('PAYMENT_INVALID_RECEIPT'))
  })
  test('rejeita JWT que não é recibo de Bits', () => {
    const t = sign({ topic: 'outro', data: { transactionId: 'x', product: {} } }, SECRET)
    assert.throws(() => decodeReceipt(t, SECRET), code('PAYMENT_INVALID_RECEIPT'))
  })
  test('rejeita lixo', () =>
    assert.throws(() => decodeReceipt('nao.eh.jwt', SECRET), code('PAYMENT_INVALID_RECEIPT')))

  test('recibo do SKU certo e valor exato passa', () =>
    assert.doesNotThrow(() => checkReceipt(decodeReceipt(receipt(), SECRET), expected)))
  test('valor maior que o custo passa', () =>
    assert.doesNotThrow(() => checkReceipt(
      decodeReceipt(receipt({ product: { sku: 'guild_creation_500', cost: { amount: 1000 } } }), SECRET),
      expected)))
  test('valor menor → PAYMENT_SKU_MISMATCH', () =>
    assert.throws(() => checkReceipt(
      decodeReceipt(receipt({ product: { sku: 'guild_creation_500', cost: { amount: 100 } } }), SECRET),
      expected), code('PAYMENT_SKU_MISMATCH')))
  test('sku diferente → PAYMENT_SKU_MISMATCH', () =>
    assert.throws(() => checkReceipt(
      decodeReceipt(receipt({ product: { sku: 'outro_produto', cost: { amount: 500 } } }), SECRET),
      expected), code('PAYMENT_SKU_MISMATCH')))
  test('recibo de outro canal → PAYMENT_SKU_MISMATCH', () =>
    assert.throws(() => checkReceipt(decodeReceipt(receipt(), SECRET), { ...expected, twitchChannelId: '999' }),
      code('PAYMENT_SKU_MISMATCH')))
})

// Precisa de Postgres migrado: `DATABASE_URL=... npm run migrate && DATABASE_URL=... npm test`
describe('banco', { skip: !process.env.DATABASE_URL }, () => {
  let db, guilds, channelId

  before(async () => {
    db = await import('../src/core/db.js')
    guilds = await import('../src/modules/guilds/index.js')
    const { rows } = await db.query(
      `INSERT INTO channel (twitch_channel_id) VALUES ($1)
       ON CONFLICT (twitch_channel_id) DO UPDATE SET twitch_channel_id = EXCLUDED.twitch_channel_id
       RETURNING id`, [`test-${process.pid}`])
    channelId = rows[0].id
  })

  after(async () => {
    await db.query('DELETE FROM channel WHERE id = $1', [channelId])
    await db.pool.end()
  })

  const draft = (name, tag, user, minutes) => db.query(
    `INSERT INTO guild (channel_id, name, tag, creator_user_id, leader_user_id,
                        status, payment_status, reserved_until)
     VALUES ($1, $2, $3, $4, $4, 'awaiting', 'awaiting', now() + make_interval(mins => $5))
     RETURNING id`, [channelId, name, tag, user, minutes])

  test('nome colide sem depender de SELECT prévio, case-insensitive (R1)', async () => {
    await draft('Void', 'VD', 'u1', 15)
    await assert.rejects(draft('void', 'VD2', 'u2', 15), { constraint: 'guild_name_uk' })
  })

  test('o mesmo viewer não abre uma segunda guilda no canal (R5)', async () => {
    await assert.rejects(draft('Outra Guilda', 'OG', 'u1', 15), { constraint: 'guild_one_per_leader_uk' })
  })

  test('reaper apaga rascunho expirado e libera o nome (R7)', async () => {
    await draft('Efemera', 'EFM', 'u3', -1)
    assert.ok(await guilds.reapExpiredDrafts() >= 1)
    await assert.doesNotReject(draft('Efemera', 'EFM', 'u4', 15))
  })
})
