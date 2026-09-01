import { test, describe, before, after } from 'node:test'
process.env.NODE_ENV = 'test'
import assert from 'node:assert/strict'
import { EVENT_TYPES } from '../src/core/events.js'
import {
  CATALOG, DEFAULT_TEMPLATES, DEFAULT_TEMPLATES_AGG, isAggregable,
  passesCatalogFilter, varsFor,
} from '../src/modules/announce/catalog.js'
import {
  decide, inQuietHours, AGG_WINDOW_MS, SPACING_MS, HOUR_MS, TTL_MS,
} from '../src/modules/announce/ratelimit.js'
import {
  finalize, listOf, parse, render, renderMessage, sanitize, validateTemplate,
  MAX_MESSAGE, MAX_TEMPLATE, TWITCH_LIMIT,
} from '../src/modules/announce/template.js'
import {
  sign, signatureHeader, verifySignature, newSecret, SIGNATURE_SKEW_S,
} from '../src/modules/announce/sign.js'
import {
  isPrivateAddress, ulid, varsFromEvent, guildEligible, processOutboxOnce, deliverNow,
} from '../src/modules/announce/worker.js'
 
// Este arquivo é o único da suíte que fala com o Postgres (seção "outbox" no
// fim) sem nunca fechar o pool depois — sem isto o processo deste arquivo de
// teste não sai sozinho e o test runner precisa matá-lo no timeout.
after(async () => {
  const { pool } = await import('../src/core/db.js')
  await pool.end()
})
 
const T0_BASE = 1_756_412_043_000            // relógio fixo; nada aqui chama Date.now()
const base = {
  priority: 'media', onCooldown: 'agrega', cooldownS: 300, hourlyCap: 12,
  sentAt: [], lastTypeAt: null, aggWindowStart: null,
}
 
// ---------------------------------------------------------------- catálogo
describe('catálogo', () => {
  test('todo tipo anunciável está registrado em EVENT_TYPES', () => {
    for (const t of Object.keys(CATALOG)) assert.ok(EVENT_TYPES.has(t), `${t} fora do registro`)
  })
 
  test('R3: guild.created nunca é anunciável', () => {
    assert.equal(CATALOG['guild.created'], undefined)
    assert.ok(CATALOG['guild.approved'], 'o gatilho público é guild.approved')
  })
 
  test('ligado por padrão segue a §3', () => {
    const ligados = Object.entries(CATALOG).filter(([, c]) => c.enabled).map(([t]) => t).sort()
    assert.deepEqual(ligados, [
      'dispute.closed', 'dispute.opened', 'guild.approved', 'guild.level_up',
      'ranking.top1_changed', 'ranking.top3_entered',
      'season.ended', 'season.started', 'territory.captured',
      'war.accepted', 'war.declared', 'war.ended',
    ])
  })
 
  test('season e recruiting não agregam; o resto agrega', () => {
    assert.equal(isAggregable('season.started'), false)
    assert.equal(isAggregable('season.ended'), false)
    assert.equal(isAggregable('guild.recruiting'), false)
    assert.equal(isAggregable('guild.approved'), true)
  })
 
  test('achievement.unlocked só entra em epic/legendary', () => {
    assert.equal(passesCatalogFilter('achievement.unlocked', { rarity: 'common' }), false)
    assert.equal(passesCatalogFilter('achievement.unlocked', { rarity: 'epic' }), true)
    assert.equal(passesCatalogFilter('war.ended', {}), true)
  })
 
  test('todo template padrão é válido, cabe em 300 e só usa variável conhecida', () => {
    for (const [type, tpl] of Object.entries(DEFAULT_TEMPLATES)) {
      assert.ok([...tpl].length <= MAX_TEMPLATE, `${type} passa de ${MAX_TEMPLATE}`)
      assert.doesNotThrow(() => validateTemplate(tpl, type))
    }
    for (const [type, tpl] of Object.entries(DEFAULT_TEMPLATES_AGG)) {
      assert.ok(isAggregable(type), `${type} tem template agregado mas não agrega`)
      assert.doesNotThrow(() => validateTemplate(tpl, type, true))
    }
  })
 
  test('variáveis comuns valem para todo evento; agregado ganha quantidade e lista', () => {
    for (const t of Object.keys(CATALOG)) {
      for (const v of ['guilda', 'tag', 'lider', 'nivel', 'prestigio', 'membros', 'canal']) {
        assert.ok(varsFor(t).has(v))
      }
      assert.equal(varsFor(t).has('quantidade'), false)
      assert.ok(varsFor(t, true).has('lista'))
    }
  })
})
 
// ------------------------------------------------------------- rate limiter
describe('rate limiter — tetos', () => {
  const sends = (n, step = 60_000, end = T0_BASE - 1000) =>
    Array.from({ length: n }, (_, i) => end - i * step)
 
  test('12º anúncio da hora passa, 13º é suprimido', () => {
    const doze = sends(11)
    assert.equal(decide({ ...base, sentAt: doze }, T0_BASE).acao, 'enviar')
    const treze = sends(12)
    const d = decide({ ...base, sentAt: treze }, T0_BASE)
    assert.deepEqual([d.acao, d.motivo], ['suprimir', 'hourly_cap'])
  })
 
  test('teto respeita hourly_cap configurado (4–20)', () => {
    assert.equal(decide({ ...base, hourlyCap: 4, sentAt: sends(3) }, T0_BASE).acao, 'enviar')
    assert.equal(decide({ ...base, hourlyCap: 4, sentAt: sends(4) }, T0_BASE).acao, 'suprimir')
    assert.equal(decide({ ...base, hourlyCap: 20, sentAt: sends(19, 120_000) }, T0_BASE).acao, 'enviar')
  })
 
  test('envio que saiu da janela de 60 min não conta', () => {
    const antigos = sends(12, 60_000, T0_BASE - HOUR_MS - 1)
    assert.equal(decide({ ...base, sentAt: antigos }, T0_BASE).acao, 'enviar')
  })
 
  test('prioridade alta é adiada até 60 s em vez de descartada na rajada', () => {
    const rajada = [T0_BASE - 21_000, T0_BASE - 40_000, T0_BASE - 55_000]   // espaçamento já satisfeito
    const d = decide({ ...base, priority: 'alta', sentAt: rajada }, T0_BASE)
    assert.equal(d.acao, 'enviar')
    assert.equal(d.notBefore, T0_BASE - 55_000 + 60_000)
    assert.ok(d.notBefore - T0_BASE <= 60_000)
  })
 
  test('teto horário estourado: alta também é descartada (a espera passa de 60 s)', () => {
    const d = decide({ ...base, priority: 'alta', sentAt: sends(12) }, T0_BASE)
    assert.deepEqual([d.acao, d.motivo], ['suprimir', 'hourly_cap'])
  })
 
  test('4ª mensagem em 60 s é adiada; a 3ª passa', () => {
    const duas = [T0_BASE - 25_000, T0_BASE - 50_000]
    assert.equal(decide({ ...base, sentAt: duas }, T0_BASE).notBefore, T0_BASE)
    const tres = [T0_BASE - 25_000, T0_BASE - 40_000, T0_BASE - 55_000]
    const d = decide({ ...base, sentAt: tres }, T0_BASE)
    assert.equal(d.acao, 'enviar')
    assert.equal(d.notBefore, T0_BASE - 55_000 + 60_000, 'espera a mais velha da rajada sair da janela')
  })
 
  test('espaçamento mínimo de 20 s entre dois anúncios', () => {
    const d = decide({ ...base, sentAt: [T0_BASE - 5000] }, T0_BASE)
    assert.equal(d.acao, 'enviar')
    assert.equal(d.notBefore, T0_BASE - 5000 + SPACING_MS)
    const ok = decide({ ...base, sentAt: [T0_BASE - SPACING_MS] }, T0_BASE)
    assert.equal(ok.notBefore, T0_BASE, 'exatamente 20 s já libera')
  })
})
 
describe('rate limiter — cooldown e agregação', () => {
  test('dentro do cooldown, tipo agregável agrega e abre janela de 300 s', () => {
    const d = decide({ ...base, lastTypeAt: T0_BASE - 10_000 }, T0_BASE)
    assert.deepEqual([d.acao, d.motivo], ['agregar', 'cooldown'])
    assert.equal(d.notBefore, T0_BASE + AGG_WINDOW_MS)
  })
 
  test('fora do cooldown envia individualmente (R15: 1 ou 2 não agregam)', () => {
    const d = decide({ ...base, cooldownS: 120, lastTypeAt: T0_BASE - 121_000 }, T0_BASE)
    assert.deepEqual([d.acao, d.motivo], ['enviar', 'ok'])
  })
 
  test('janela aberta captura o evento mesmo fora do cooldown', () => {
    const start = T0_BASE - 200_000
    const d = decide({ ...base, cooldownS: 30, lastTypeAt: null, aggWindowStart: start }, T0_BASE)
    assert.deepEqual([d.acao, d.motivo], ['agregar', 'aggregate_window'])
    assert.equal(d.notBefore, start + AGG_WINDOW_MS, 'todos os membros compartilham o fim da janela')
  })
 
  test('janela vencida não captura mais nada', () => {
    const d = decide({ ...base, aggWindowStart: T0_BASE - AGG_WINDOW_MS }, T0_BASE)
    assert.equal(d.acao, 'enviar')
  })
 
  test('tipo com descarte no cooldown vira suprimido (season, recruiting)', () => {
    const d = decide({ ...base, onCooldown: 'descarta', cooldownS: 3600, lastTypeAt: T0_BASE - 1000 }, T0_BASE)
    assert.deepEqual([d.acao, d.motivo], ['suprimir', 'cooldown'])
  })
 
  test('R16: tipo "ultimo" envia e marca o anterior como superseded', () => {
    const d = decide({ ...base, onCooldown: 'ultimo', cooldownS: 600, lastTypeAt: T0_BASE - 1000 }, T0_BASE)
    assert.deepEqual([d.acao, d.motivo], ['enviar', 'supersede'])
  })
})
 
describe('rate limiter — silêncio', () => {
  test('R11: mute descarta, não acumula', () => {
    const d = decide({ ...base, mutedUntil: T0_BASE + 1 }, T0_BASE)
    assert.deepEqual([d.acao, d.motivo], ['suprimir', 'muted'])
    assert.equal(decide({ ...base, mutedUntil: T0_BASE }, T0_BASE).acao, 'enviar', 'mute vencido libera')
  })
 
  test('canal offline descarta', () => {
    assert.equal(decide({ ...base, offline: true }, T0_BASE).motivo, 'offline')
  })
 
  test('quiet hours 02:00–10:00 em America/Sao_Paulo', () => {
    const q = { from: '02:00', to: '10:00', timezone: 'America/Sao_Paulo' }
    const at = (iso) => Date.parse(iso)
    assert.equal(inQuietHours(at('2026-08-28T06:00:00Z'), q), true, '03:00 local')
    assert.equal(inQuietHours(at('2026-08-28T13:01:00Z'), q), false, '10:01 local')
    assert.equal(inQuietHours(at('2026-08-28T05:00:00Z'), q), true, '02:00 local, borda inclusiva')
    assert.equal(inQuietHours(at('2026-08-28T13:00:00Z'), q), false, '10:00 local, borda exclusiva')
    assert.equal(decide({ ...base, quiet: q }, at('2026-08-28T06:00:00Z')).motivo, 'quiet_hours')
  })
 
  test('quiet hours viram a meia-noite', () => {
    const q = { from: '22:00', to: '06:00', timezone: 'America/Sao_Paulo' }
    assert.equal(inQuietHours(Date.parse('2026-08-29T02:00:00Z'), q), true, '23:00 local')
    assert.equal(inQuietHours(Date.parse('2026-08-28T18:00:00Z'), q), false, '15:00 local')
  })
 
  test('quiet hours respeitam o fuso do canal', () => {
    const t = Date.parse('2026-08-28T06:00:00Z')   // 03:00 em SP, 15:00 em Tóquio
    assert.equal(inQuietHours(t, { from: '02:00', to: '10:00', timezone: 'America/Sao_Paulo' }), true)
    assert.equal(inQuietHours(t, { from: '02:00', to: '10:00', timezone: 'Asia/Tokyo' }), false)
  })
 
  test('silêncio vem antes de qualquer outra avaliação', () => {
    const d = decide({ ...base, mutedUntil: T0_BASE + 1, lastTypeAt: T0_BASE - 1, sentAt: [T0_BASE - 1] }, T0_BASE)
    assert.equal(d.motivo, 'muted')
  })
 
  test('TTL da fila é 600 s (R12)', () => assert.equal(TTL_MS, 600_000))
})
 
// --------------------------------------------------------------- templates
describe('template — parsing e validação', () => {
  test('{{ e }} viram chaves literais', () => {
    assert.equal(render('{{{tag}}}', { tag: 'ORDM' }), '{ORDM}')
    assert.equal(render('{{}}', {}), '{}')
  })
 
  test('chave não fechada é INVALID_TEMPLATE', () => {
    for (const t of ['oi {tag', 'oi }', '{ tag }', '{Tag}']) {
      assert.throws(() => parse(t), { code: 'INVALID_TEMPLATE' }, t)
    }
  })
 
  test('variável desconhecida é rejeitada na gravação, não no envio', () => {
    assert.throws(() => validateTemplate('{guilda} {nao_existe}', 'guild.approved'),
      { code: 'UNKNOWN_VARIABLE' })
    // {posicao} não é variável de guild.approved
    assert.throws(() => validateTemplate('{posicao}', 'guild.approved'), { code: 'UNKNOWN_VARIABLE' })
    assert.doesNotThrow(() => validateTemplate('{oponente}', 'war.declared'))
  })
 
  test('{quantidade} e {lista} só existem no template agregado', () => {
    assert.throws(() => validateTemplate('{quantidade}', 'guild.approved'), { code: 'UNKNOWN_VARIABLE' })
    assert.doesNotThrow(() => validateTemplate('{quantidade} {lista}', 'guild.approved', true))
  })
 
  test('template com 300 caracteres passa, 301 não', () => {
    assert.doesNotThrow(() => validateTemplate('a'.repeat(300), 'guild.approved'))
    assert.throws(() => validateTemplate('a'.repeat(301), 'guild.approved'), { code: 'TEMPLATE_TOO_LONG' })
  })
 
  test('limite do template conta code points, não unidades UTF-16', () => {
    assert.doesNotThrow(() => validateTemplate('⚔️'.repeat(150), 'guild.approved'))
  })
 
  test('template vazio equivale a desligado', () => {
    assert.equal(validateTemplate('', 'guild.approved'), null)
    assert.equal(validateTemplate(null, 'guild.approved'), null)
  })
})
 
describe('template — render', () => {
  test('variável ausente em runtime vira string vazia e a mensagem ainda vai', () => {
    assert.equal(render('[{tag}] {desbloqueio}!', { tag: 'ORDM' }), '[ORDM] !')
    assert.equal(render('{lider}', { lider: null }), '')
  })
 
  test('números saem formatados em pt-BR', () => {
    assert.equal(render('{prestigio}', { prestigio: 14520 }), '14.520')
    assert.equal(sanitize(1000000), '1.000.000')
  })
 
  test('R18: quebra de linha, tab e caractere de controle somem', () => {
    assert.equal(sanitize('Ordem\r\nCarmesim\tX'), 'Ordem Carmesim X')
    assert.equal(sanitize('ab'), 'a b')
    assert.match(render('{guilda}', { guilda: 'a\nb' }), /^a b$/)
  })
 
  test('R18: tags Unicode invisíveis (U+E0000–U+E007F) são removidas', () => {
    assert.equal(sanitize('Void\u{E0041}\u{E007F}'), 'Void')
  })
 
  test('runs de space são colapsados e as pontas aparadas', () => {
    assert.equal(sanitize('  a     b  '), 'a b')
  })
 
  test('R18: mensagem que começa por / ou . ganha ZWSP e não vira comando', () => {
    const m = finalize('/ban Foyth')
    assert.notEqual(m[0], '/')
    assert.equal(m.charCodeAt(0), 0x200b)
    assert.equal(m.slice(1), '/ban Foyth')
    assert.equal(finalize('.timeout x').charCodeAt(0), 0x200b)
    assert.equal(finalize('⚔️ ok')[0], '⚔')
  })
})
 
describe('template — limite de tamanho (R13)', () => {
  test('400 caracteres passam intactos', () => {
    const m = finalize('x'.repeat(400))
    assert.equal([...m].length, 400)
    assert.equal(m.endsWith('…'), false)
  })
 
  test('401 caracteres truncam em 399 + reticências', () => {
    const m = finalize('x'.repeat(401))
    assert.equal([...m].length, MAX_MESSAGE)
    assert.equal(m, 'x'.repeat(399) + '…')
  })
 
  test('template que renderiza 600 caracteres entrega 400', () => {
    const { message } = renderMessage({
      eventType: 'guild.approved', template: '{guilda}', vars: { guilda: 'y'.repeat(600), tag: 'T' },
    })
    assert.equal([...message].length, 400)
    assert.ok([...message].length < TWITCH_LIMIT, 'sempre abaixo do limite da Twitch')
  })
 
  test('truncagem não parte emoji ao meio', () => {
    const m = finalize('🐉'.repeat(500))
    assert.equal([...m].length, 400)
    assert.ok(m.endsWith('🐉…'))
  })
})
 
describe('template — fallback (R17)', () => {
  const vars = { guilda: 'Eclipse', tag: 'ECL', lider: 'Foyth' }
 
  test('template do streamer é usado quando renderiza', () => {
    const r = renderMessage({ eventType: 'guild.approved', template: 'oi {guilda}', vars })
    assert.deepEqual(r, { message: 'oi Eclipse', fallbackUsed: false })
  })
 
  test('template quebrado em runtime cai no padrão do evento', () => {
    const r = renderMessage({ eventType: 'guild.approved', template: 'oi {guilda', vars })
    assert.equal(r.fallbackUsed, true)
    assert.match(r.message, /NOVA GUILDA CRIADA/)
  })
 
  test('sem padrão para o tipo, cai em [{tag}] {evento}', () => {
    const r = renderMessage({ eventType: 'season.started', template: '{quebrado', vars, agg: true })
    assert.deepEqual(r, { message: '[ECL] season.started', fallbackUsed: true })
  })
 
  test('a mensagem mínima também é higienizada', () => {
    const r = renderMessage({ eventType: 'season.started', template: '{x', vars: { tag: 'a\nb' }, agg: true })
    assert.equal(r.message, '[a b] season.started')
  })
 
  test('sem template do streamer o padrão não conta como fallback', () => {
    const r = renderMessage({ eventType: 'guild.approved', template: null, vars })
    assert.equal(r.fallbackUsed, false, 'fallback_used marca falha de render, não ausência de template')
  })
})
 
describe('template — lista agregada', () => {
  test('até 3 nomes saem inteiros', () => {
    assert.equal(listOf(['A', 'B']), 'A, B')
    assert.equal(listOf(['A', 'B', 'C']), 'A, B, C')
  })
 
  test('10 guildas viram 3 nomes + e mais 7', () => {
    const nomes = ['Ordem Carmesim', 'Eclipse', 'Void', ...Array.from({ length: 7 }, (_, i) => `G${i}`)]
    assert.equal(listOf(nomes), 'Ordem Carmesim, Eclipse, Void e mais 7')
  })
 
  test('a mensagem agregada padrão bate com o exemplo da §6', () => {
    const nomes = ['Ordem Carmesim', 'Eclipse', 'Void', ...Array.from({ length: 7 }, (_, i) => `G${i}`)]
    const { message } = renderMessage({
      eventType: 'guild.approved', agg: true, template: null,
      vars: { quantidade: 10, lista: listOf(nomes) },
    })
    assert.equal(message,
      '⚔️ 10 novas guildas nasceram: Ordem Carmesim, Eclipse, Void e mais 7. Abra a extensão para entrar em uma!')
  })
})
 
// ------------------------------------------------------------------- HMAC
describe('assinatura', () => {
  const SECRET = 'segredo-de-teste'
  const TS = 1_756_412_043
  const BODY = '{"a":1}'
  // Vetor fixo, conferido com: printf '1756412043.{"a":1}' | openssl dgst -sha256 -hmac 'segredo-de-teste'
  const VECTOR = '312aa578e5d6d86e7b596af305efe25f7dd9ae65c699cd8d16da7b4d67fa0350'
 
  test('HMAC-SHA256 sobre timestamp.corpo, hex minúsculo', () => {
    assert.equal(sign(SECRET, TS, BODY), VECTOR)
    assert.equal(sign(SECRET, String(TS), BODY), VECTOR, 'timestamp numérico ou string dá o mesmo')
    assert.match(VECTOR, /^[0-9a-f]{64}$/)
  })
 
  test('o separador é o ponto, não a concatenação crua', () => {
    assert.notEqual(sign(SECRET, TS, BODY), sign(SECRET, '', `${TS}${BODY}`))
  })
 
  test('header traz um v1= por segredo vivo (janela de rotação)', () => {
    assert.equal(signatureHeader([SECRET], TS, BODY), `v1=${VECTOR}`)
    const dois = signatureHeader([SECRET, 'outro'], TS, BODY)
    assert.equal(dois.split(',').length, 2)
    assert.ok(dois.startsWith(`v1=${VECTOR},v1=`))
  })
 
  test('verifica quando qualquer valor bate with qualquer segredo', () => {
    const now = TS * 1000
    const header = signatureHeader(['antigo', SECRET], TS, BODY)
    assert.equal(verifySignature({ header, timestamp: TS, body: BODY, secrets: [SECRET], now }), true)
    assert.equal(verifySignature({ header, timestamp: TS, body: BODY, secrets: ['antigo'], now }), true)
    assert.equal(verifySignature({ header, timestamp: TS, body: BODY, secrets: ['terceiro'], now }), false)
  })
 
  test('corpo adulterado não valida', () => {
    const now = TS * 1000
    assert.equal(verifySignature({
      header: `v1=${VECTOR}`, timestamp: TS, body: '{"a":2}', secrets: [SECRET], now,
    }), false)
  })
 
  test('timestamp adulterado em 6 min é rejeitado (janela de ±300 s)', () => {
    const at = (deltaS) => verifySignature({
      header: signatureHeader([SECRET], TS, BODY),
      timestamp: TS, body: BODY, secrets: [SECRET], now: (TS + deltaS) * 1000,
    })
    assert.equal(at(0), true)
    assert.equal(at(SIGNATURE_SKEW_S), true)
    assert.equal(at(SIGNATURE_SKEW_S + 1), false)
    assert.equal(at(-360), false, '6 min no passado')
    assert.equal(at(360), false, '6 min no futuro')
  })
 
  test('header vazio ou lixo não valida', () => {
    const now = TS * 1000
    for (const header of [undefined, '', 'v1=', 'nada', VECTOR.slice(0, 10)]) {
      assert.equal(verifySignature({ header, timestamp: TS, body: BODY, secrets: [SECRET], now }), false)
    }
  })
 
  test('segredo é 32 bytes em hex (§11)', () => {
    const s = newSecret()
    assert.match(s, /^[0-9a-f]{64}$/)
    assert.notEqual(s, newSecret())
  })
})
 
// -------------------------------------------------------------- utilitários
describe('SSRF e elegibilidade', () => {
  test('bloqueia loopback, link-local, privados e metadata', () => {
    for (const ip of ['127.0.0.1', '169.254.169.254', '10.1.2.3', '172.16.0.1',
      '172.31.255.255', '192.168.0.1', '0.0.0.0', '100.64.0.1']) {
      assert.equal(isPrivateAddress(ip, 4), true, ip)
    }
    for (const ip of ['::1', 'fd00::1', 'fc00::1', 'fe80::1']) {
      assert.equal(isPrivateAddress(ip, 6), true, ip)
    }
  })
 
  test('deixa passar endereço público', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '172.32.0.1', '192.169.0.1', '99.1.2.3']) {
      assert.equal(isPrivateAddress(ip, 4), false, ip)
    }
    assert.equal(isPrivateAddress('2606:4700::1111', 6), false)
  })
 
  test('R3/R4: só guilda pública anuncia', () => {
    for (const s of ['active', 'overflow']) assert.equal(guildEligible(s), true)
    for (const s of ['pending', 'awaiting', 'suspended', 'banned', 'purged']) {
      assert.equal(guildEligible(s), false, s)
    }
    assert.equal(guildEligible(null), true, 'evento sem guilda (temporada) não é barrado')
  })
 
  test('ULID tem 26 chars em Crockford e é ordenável por tempo', () => {
    const a = ulid(T0_BASE)
    const b = ulid(T0_BASE + 1000)
    assert.match(a, /^[0-9A-HJKMNP-TV-Z]{26}$/)
    assert.ok(a.slice(0, 10) < b.slice(0, 10))
    assert.notEqual(ulid(T0_BASE), ulid(T0_BASE))
  })
})
 
describe('variáveis do evento', () => {
  const row = (type, payload) => ({
    type, payload, guild_name: 'Eclipse', guild_tag: 'ECL',
    guild_level: 7, guild_prestige: 14520, member_count: 18, channel_name: '141981764',
  })
 
  test('R20: não vaza user_id, opaque_user_id nem Bits', () => {
    const v = varsFromEvent(row('guild.approved', {
      actor_user_id: '12345', opaque_user_id: 'U9', bits: 500, leader_name: 'Foyth',
    }))
    const flat = JSON.stringify(v)
    for (const proibido of ['12345', 'U9', '500', 'user_id', 'opaque', 'bits']) {
      assert.equal(flat.includes(proibido), false, `vazou ${proibido}`)
    }
    assert.equal(v.lider, 'Foyth')
  })
 
  test('mapeia o payload documentado para as variáveis pt-BR', () => {
    const v = varsFromEvent(row('guild.level_up', { from: 6, to: 7, unlocks: ['Emblema', 'Slot'] }))
    assert.equal(v.nivel_anterior, 6)
    assert.equal(v.nivel, 7)
    assert.equal(v.desbloqueio, 'Emblema, Slot')
  })
 
  test('o produtor pode mandar a variável em pt-BR e ela ganha', () => {
    const v = varsFromEvent(row('guild.recruiting', { vagas: 4, modo: 'aberta' }))
    assert.deepEqual([v.vagas, v.modo], [4, 'aberta'])
  })
 
  test('season.ended abre o pódio', () => {
    const v = varsFromEvent(row('season.ended', { name: 'T3', podium: ['A', 'B', 'C'] }))
    assert.deepEqual([v.temporada, v.primeiro, v.segundo, v.terceiro], ['T3', 'A', 'B', 'C'])
  })
 
  test('renderiza o template padrão with o que o evento traz', () => {
    const v = varsFromEvent(row('war.declared', {
      opponent_name: 'Void', opponent_tag: 'VOID', format: '48 h',
    }))
    const { message } = renderMessage({ eventType: 'war.declared', template: null, vars: v })
    assert.equal(message, '⚔️ Eclipse [ECL] declarou guerra a Void [VOID]! Duração: 48 h.')
  })
})
 
// -------------------------------------------------------------------- banco
// Sem DATABASE_URL não existe teste de fila: mock de banco mente sobre
// constraint, que é justamente onde R5/R6/R14 vivem.
describe('outbox (precisa de Postgres)', { skip: !process.env.DATABASE_URL }, () => {
  test('migração 070 cria as cinco tabelas do módulo', async () => {
    const { query } = await import('../src/core/db.js')
    const { rows } = await query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name LIKE 'announce_%' ORDER BY 1`)
    assert.deepEqual(rows.map(r => r.table_name), [
      'announce_config', 'announce_delivery_log', 'announce_event_config',
      'announce_outbox', 'announce_secret',
    ])
  })
 
  test('R5/R14: dedup_key é único por canal', async () => {
    const { query } = await import('../src/core/db.js')
    const { rows } = await query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'announce_outbox_dedup'`)
    assert.match(rows[0].indexdef, /UNIQUE.*channel_id, dedup_key/)
  })
})
 
// ------------------------------------------------------- dispatch (Postgres)
// Exercita processOutboxOnce/deliverNow de ponta a ponta: webhook fake via
// fetchImpl (nunca sai da máquina), mas leitura/escrita reais no Postgres —
// é onde vivem R8, R9, R12 e R19, que não dá pra validar só com funções puras.
// assertPublicUrl faz um DNS lookup de verdade (não é injetável), então o
// canal aqui usa um webhook_url público de verdade (example.com) — os testes
// desta suíte precisam de acesso à internet além do Postgres.
describe('dispatch e entrega (Postgres)', { skip: !process.env.DATABASE_URL }, () => {
  const sufixo = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  let channelId
  let db
 
  before(async () => {
    db = await import('../src/core/db.js')
    const { migrate } = await import('../src/core/migrate.js')
    await migrate(() => {})
 
    const { rows: [ch] } = await db.query(
      'INSERT INTO channel (twitch_channel_id) VALUES ($1) RETURNING id', [`test-dispatch-${sufixo}`])
    channelId = ch.id
 
    await db.query(
      `INSERT INTO announce_config (channel_id, enabled, webhook_url, hourly_cap, enabled_at)
       VALUES ($1, true, 'https://example.com/webhook', 12, now())`, [channelId])
 
    const { encryptSecret, newSecret } = await import('../src/modules/announce/sign.js')
    await db.query(
      `INSERT INTO announce_secret (channel_id, secret_enc, status) VALUES ($1, $2, 'active')`,
      [channelId, encryptSecret(newSecret())])
  })
 
  after(async () => {
    if (channelId) await db.query('DELETE FROM channel WHERE id = $1', [channelId])
  })
 
  const insertItem = async (over = {}) => {
    const id = ulid()
    await db.query(
      `INSERT INTO announce_outbox
         (id, channel_id, event_type, priority, dedup_key, status, message, payload,
          attempts, not_before, expires_at)
       VALUES ($1, $2, $3, $4, $1, $5, 'oi', '{}'::jsonb, $6, $7, $8)`,
      [id, channelId, over.eventType ?? 'ranking.top1_changed', over.priority ?? 'alta',
        over.status ?? 'queued', over.attempts ?? 0,
        over.notBefore ?? new Date(0), over.expiresAt ?? new Date(Date.now() + 600_000)])
    return id
  }
 
  const itemRow = async (id) =>
    (await db.query('SELECT * FROM announce_outbox WHERE id = $1', [id])).rows[0]
 
  const configRow = async () =>
    (await db.query('SELECT * FROM announce_config WHERE channel_id = $1', [channelId])).rows[0]
 
  const resetChannel = () => Promise.all([
    db.query(
      `UPDATE announce_config SET enabled = true, fail_streak = 0,
              webhook_url = 'https://example.com/webhook' WHERE channel_id = $1`, [channelId]),
    db.query('DELETE FROM announce_outbox WHERE channel_id = $1', [channelId]),
  ])
 
  test('bot devolvendo 500: fica queued, agenda retry com backoff de ~2s (±20%)', async () => {
    await resetChannel()
    const T0 = Date.now()
    const id = await insertItem({ attempts: 0 })
    const fetchImpl = async () => ({ status: 500 })
 
    await processOutboxOnce(db, { channelId, now: T0, fetchImpl })
 
    const item = await itemRow(id)
    assert.equal(item.status, 'queued')
    assert.equal(item.attempts, 1)
    const waited = +new Date(item.not_before) - T0
    assert.ok(waited >= 1600 && waited <= 2400, `backoff fora da janela: ${waited}ms`)
 
    const { rows: log } = await db.query(
      'SELECT * FROM announce_delivery_log WHERE outbox_id = $1', [id])
    assert.equal(log.length, 1)
    assert.equal(log[0].attempt, 1)
    assert.equal(log[0].http_status, 500)
  })
 
  test('R19: 3ª tentativa falha vira failed e soma no fail_streak do canal', async () => {
    await resetChannel()
    const T0 = Date.now()
    const id = await insertItem({ attempts: 2 })   // próxima tentativa é a 3ª
    const fetchImpl = async () => ({ status: 500 })
 
    await processOutboxOnce(db, { channelId, now: T0, fetchImpl })
 
    const item = await itemRow(id)
    assert.equal(item.status, 'failed')
    assert.equal(item.attempts, 3)
    assert.match(item.suppress_reason, /http 500/)
    assert.equal((await configRow()).fail_streak, 1)
  })
 
  test('R19: 10 falhas terminais seguidas desligam announce_config.enabled', async () => {
    await resetChannel()
    const T0 = Date.now()
    const ids = await Promise.all(Array.from({ length: 10 }, () => insertItem({ attempts: 2 })))
    const fetchImpl = async () => ({ status: 500 })
 
    await processOutboxOnce(db, { channelId, now: T0, fetchImpl, max: 25 })
 
    for (const id of ids) assert.equal((await itemRow(id)).status, 'failed')
    const cfg = await configRow()
    assert.equal(cfg.fail_streak, 10)
    assert.equal(cfg.enabled, false)
  })
 
  test('R12: item vencido nunca é tentado — vira expired sem chamar o webhook', async () => {
    await resetChannel()
    const T0 = Date.now()
    const id = await insertItem({ expiresAt: new Date(T0 - 1000) })
    const fetchImpl = async () => { throw new Error('não deveria ter sido chamado') }
 
    await processOutboxOnce(db, { channelId, now: T0, fetchImpl })
 
    assert.equal((await itemRow(id)).status, 'expired')
  })
 
  test('sucesso (2xx): marca sent, grava sent_at e zera o fail_streak', async () => {
    await resetChannel()
    await db.query('UPDATE announce_config SET fail_streak = 5 WHERE channel_id = $1', [channelId])
    const T0 = Date.now()
    const id = await insertItem({ attempts: 0 })
    const fetchImpl = async () => ({ status: 200 })
 
    await processOutboxOnce(db, { channelId, now: T0, fetchImpl })
 
    const item = await itemRow(id)
    assert.equal(item.status, 'sent')
    assert.ok(item.sent_at)
    assert.equal((await configRow()).fail_streak, 0)
  })
 
  test('SSRF revalidada no dispatch: webhook apontando pra IP privado nunca chama fetchImpl e conta como falha', async () => {
    await resetChannel()
    await db.query(
      `UPDATE announce_config SET webhook_url = 'https://localhost/webhook' WHERE channel_id = $1`, [channelId])
    const T0 = Date.now()
    const id = await insertItem({ attempts: 0 })
    const fetchImpl = async () => { throw new Error('não deveria ter sido chamado') }
 
    await processOutboxOnce(db, { channelId, now: T0, fetchImpl })
 
    const item = await itemRow(id)
    assert.equal(item.status, 'failed')
    assert.match(item.suppress_reason, /webhook_blocked/)
    assert.equal((await configRow()).fail_streak, 1)
  })
 
  test('R21: deliverNow (POST /announce/test) entrega direto, fora do teto horário', async () => {
    await resetChannel()
    const T0 = Date.now()
    const id = await insertItem({ attempts: 0 })
    const fetchImpl = async () => ({ status: 200 })
 
    const r = await deliverNow(channelId, id, { now: T0, fetchImpl })
 
    assert.equal(r.status, 200)
    assert.equal((await itemRow(id)).status, 'sent')
  })
})

describe('fluxo completo e agregação (Postgres)', { skip: !process.env.DATABASE_URL }, () => {
  let db
  let ingestOnce, flushAggregates, processOutboxOnce

  before(async () => {
    db = await import('../src/core/db.js')
    const worker = await import('../src/modules/announce/worker.js')
    ingestOnce = worker.ingestOnce
    flushAggregates = worker.flushAggregates
    processOutboxOnce = worker.processOutboxOnce

    const { migrate } = await import('../src/core/migrate.js')
    await migrate(() => {})
  })

  const setupChannel = async (id_str) => {
    const { rows: [ch] } = await db.query(
      'INSERT INTO channel (twitch_channel_id) VALUES ($1) RETURNING id', [id_str])
    const cid = ch.id
    const t_config = new Date(Date.now() - 3600_000) // 1h atrás
    await db.query(
      `INSERT INTO announce_config (channel_id, enabled, webhook_url, hourly_cap, enabled_at)
       VALUES ($1, true, 'https://example.com/webhook', 12, $2)`, [cid, t_config])
    const { CATALOG } = await import('../src/modules/announce/catalog.js')
    for (const [type, cat] of Object.entries(CATALOG)) {
      await db.query(
        `INSERT INTO announce_event_config (channel_id, event_type, enabled, cooldown_s)
         VALUES ($1, $2, $3, $4)`, [cid, type, true, cat.cooldownS])
    }
    return cid
  }

  const insertEvent = async (cid, type, payload = {}, at = new Date(), guildId = null) => {
    const res = await db.query(
      `INSERT INTO guild_event (channel_id, guild_id, type, payload, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [cid, guildId, type, JSON.stringify(payload), at])
    return res.rows[0].id
  }

  test('01 — Agregação em Lote: 10 guild.approved em 5 min → 1 individual + 1 agregada de 9 (R15)', async () => {
    const cid = await setupChannel(`test-agg-1-${Math.random()}`)
    const T0 = Math.floor(Date.now() / 1000) * 1000
    for (let i = 0; i < 10; i++) {
      await insertEvent(cid, 'guild.approved', { guilda: `Guilda ${i}` }, new Date(T0 + i * 100))
    }

    await ingestOnce(db, { channelId: cid, now: T0 + 10000 })
    const made = await flushAggregates(db, { channelId: cid, now: T0 + 320_000 })
    assert.equal(made, 1)

    const { rows: outbox } = await db.query(
      "SELECT status, aggregate_count FROM announce_outbox WHERE channel_id = $1 ORDER BY id", [cid])

    assert.equal(outbox.filter(r => r.status === 'aggregated').length, 9)
    assert.equal(outbox.filter(r => r.status === 'queued').length, 2)
  })

  test('02 — Idempotência: rodar ingestOnce duas vezes não duplica mensagens', async () => {
    const cid = await setupChannel(`test-agg-2-${Math.random()}`)
    const T0 = Date.now()
    await insertEvent(cid, 'guild.approved', { guilda: 'Unica' }, new Date(T0))

    const res1 = await ingestOnce(db, { channelId: cid, now: T0 })
    assert.equal(res1.enqueued, 1)

    const res2 = await ingestOnce(db, { channelId: cid, now: T0 + 1000 })
    assert.equal(res2.enqueued, 0)

    const { rows } = await db.query("SELECT count(*)::int FROM announce_outbox WHERE channel_id = $1", [cid])
    assert.equal(rows[0].count, 1)
  })

  test('03 — Respeito à Janela: 2 eventos em janela e depois viram individuais', async () => {
    const cid = await setupChannel(`test-agg-3-${Math.random()}`)
    const T0 = Math.floor(Date.now() / 1000) * 1000
    // Usamos um tipo que agrega e que NÃO foi usado antes
    const type = 'territory.captured'
    await insertEvent(cid, type, { territorio: 'A' }, new Date(T0))
    await insertEvent(cid, type, { territorio: 'B' }, new Date(T0 + 1000))

    // Forçamos o processamento seqüencial no ingest para garantir que d.lastTypeAt seja isolado
    await ingestOnce(db, { channelId: cid, now: T0 + 500 }) // E0 individual
    await ingestOnce(db, { channelId: cid, now: T0 + 2000 }) // E1 agrega

    const { rows: r1 } = await db.query("SELECT agg_window FROM announce_outbox WHERE channel_id = $1 ORDER BY id", [cid])
    assert.equal(r1.length, 2)
    assert.equal(r1[0].agg_window, null, 'primeiro deve ser individual')
    assert.ok(r1[1].agg_window !== null, 'segundo deve ser agregado')

    await flushAggregates(db, { channelId: cid, now: T0 + 360_000 })
    const { rows: r2 } = await db.query("SELECT status, agg_window FROM announce_outbox WHERE channel_id = $1", [cid])
    assert.equal(r2.filter(r => r.status === 'queued').length, 2)
    assert.ok(r2.every(r => r.agg_window === null))
  })

  test('04 — Ranking / Supersede: A->B->C deixa apenas C ativa no banco (R16)', async () => {
    const cid = await setupChannel(`test-agg-4-${Math.random()}`)
    const T0 = Date.now()
    await insertEvent(cid, 'ranking.top1_changed', { tag: 'AAA' }, new Date(T0))
    await ingestOnce(db, { channelId: cid, now: T0 })

    await insertEvent(cid, 'ranking.top1_changed', { tag: 'BBB' }, new Date(T0 + 1000))
    await ingestOnce(db, { channelId: cid, now: T0 + 1000 })

    await insertEvent(cid, 'ranking.top1_changed', { tag: 'CCC' }, new Date(T0 + 2000))
    await ingestOnce(db, { channelId: cid, now: T0 + 2000 })

    const { rows: outbox } = await db.query(
      "SELECT status, message FROM announce_outbox WHERE channel_id = $1 ORDER BY id", [cid])

    assert.equal(outbox.filter(r => r.status === 'superseded').length, 2)
    assert.equal(outbox.filter(r => r.status === 'queued').length, 1)
    assert.match(outbox.find(r => r.status === 'queued').message, /CCC/)
  })

  test('05 — Resiliência / Retry: Webhook 500 permanece na outbox para retry', async () => {
    const cid = await setupChannel(`test-agg-5-${Math.random()}`)
    const T0 = Date.now()
    await insertEvent(cid, 'war.declared', { oponente: 'Inimigo' }, new Date(T0))
    await ingestOnce(db, { channelId: cid, now: T0 })

    const { rows: [item] } = await db.query("SELECT id FROM announce_outbox WHERE channel_id = $1", [cid])

    let calls = 0
    await processOutboxOnce(db, { channelId: cid, now: T0, fetchImpl: async () => { calls++; return { status: 500 } } })

    const row1 = await db.query("SELECT status, attempts FROM announce_outbox WHERE id = $1", [item.id])
    assert.equal(row1.rows[0].status, 'queued')
    assert.equal(row1.rows[0].attempts, 1)

    await processOutboxOnce(db, { channelId: cid, now: T0 + 10000, fetchImpl: async () => { calls++; return { status: 200 } } })

    const row2 = await db.query("SELECT status FROM announce_outbox WHERE id = $1", [item.id])
    assert.equal(row2.rows[0].status, 'sent')
    assert.equal(calls, 2)
  })

  test('06 — Matriz de Formatação: Pluralização, Unicode e Truncagem', async () => {
    const cid = await setupChannel(`test-agg-6-${Math.random()}`)
    const T0 = Math.floor(Date.now() / 1000) * 1000

    // Inserimos 10 eventos para garantir a agregação (1 indiv + 9 agg)
    for (let i = 0; i < 10; i++) {
      await insertEvent(cid, 'guild.approved', { guilda: `G${i}` }, new Date(T0 + i * 100))
    }

    await ingestOnce(db, { channelId: cid, now: T0 + 10000 })
    const made = await flushAggregates(db, { channelId: cid, now: T0 + 320_000 })
    assert.equal(made, 1)

    const { rows: rows_agg } = await db.query(
      "SELECT message FROM announce_outbox WHERE channel_id = $1 AND aggregate_count = 9", [cid])
    assert.match(rows_agg[0].message, /9 novas guildas nasceram/)

    const longName = 'A Ordem Suprema dos Cavaleiros Lendários de ' + 'A'.repeat(100)
    await insertEvent(cid, 'guild.approved', { guilda: longName, lider: 'João 🛡️' }, new Date(T0 + 400_000))
    await ingestOnce(db, { channelId: cid, now: T0 + 400_000 })

    const { rows: rows2 } = await db.query(
      "SELECT message FROM announce_outbox WHERE channel_id = $1 AND aggregate_count = 1 ORDER BY id DESC LIMIT 1", [cid])
    const ind = rows2[0]
    assert.ok(ind.message.length <= 400)
    assert.match(ind.message, /João 🛡️ fundou A Ordem Suprema/)
  })

  test('07 — Agregação + Falha + Retry: Fluxo Combinado', async () => {
    const cid = await setupChannel(`test-agg-7-${Math.random()}`)
    const T0 = Math.floor(Date.now() / 1000) * 1000
    const type = 'war.ended'
    for (let i = 0; i < 10; i++) await insertEvent(cid, type, { guilda: `G${i}`, vencedor: 'A' }, new Date(T0 + i * 100))

    await ingestOnce(db, { channelId: cid, now: T0 + 10000 })
    const made = await flushAggregates(db, { channelId: cid, now: T0 + 320_000 })
    assert.equal(made, 1)

    const { rows: [agg] } = await db.query(
      "SELECT id FROM announce_outbox WHERE channel_id = $1 AND status = 'queued' AND aggregate_count = 9", [cid])

    await processOutboxOnce(db, { channelId: cid, now: T0 + 320_000, fetchImpl: async () => ({ status: 500 }) })
    // Avançamos para garantir que limpa burst e spacing.
    // O primeiro (G0) será enviado, o segundo (Aggregate) pegará o spacing e será adiado.
    await processOutboxOnce(db, { channelId: cid, now: T0 + 380_000, fetchImpl: async () => ({ status: 204 }) })
    // Terceira chamada para pegar o adiado.
    await processOutboxOnce(db, { channelId: cid, now: T0 + 410_000, fetchImpl: async () => ({ status: 204 }) })

    const row2 = await db.query("SELECT status FROM announce_outbox WHERE id = $1", [agg.id])
    assert.equal(row2.rows[0].status, 'sent')
  })
})
