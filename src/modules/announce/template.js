import { badRequest } from '../../core/errors.js'
import { DEFAULT_TEMPLATES, DEFAULT_TEMPLATES_AGG, varsFor } from './catalog.js'

export const TWITCH_LIMIT = 500         // limite duro do chat da Twitch
export const MAX_MESSAGE = 400          // §5: folga de 100 para o prefixo do bot
export const MAX_TEMPLATE = 300         // §5 / CHECK tpl_len
const ZWSP = String.fromCharCode(0x200b)

// Contagem em code points, igual a char_length() do Postgres: emoji conta 1.
const cps = (s) => [...s]

const TOKEN = /\{\{|\}\}|\{([a-z_][a-z0-9_]*)\}/g

/**
 * Tokeniza `{var}` com `{{`/`}}` literais. Chave solta é template inválido —
 * melhor 400 na gravação (R17) que uma mensagem estranha no chat do streamer.
 */
export function parse (template) {
  const out = []
  let i = 0
  TOKEN.lastIndex = 0
  for (let m; (m = TOKEN.exec(template));) {
    const lit = template.slice(i, m.index)
    if (/[{}]/.test(lit)) throw badRequest('INVALID_TEMPLATE', 'chave não fechada')
    if (lit) out.push({ lit })
    if (m[0] === '{{') out.push({ lit: '{' })
    else if (m[0] === '}}') out.push({ lit: '}' })
    else out.push({ v: m[1] })
    i = m.index + m[0].length
  }
  const tail = template.slice(i)
  if (/[{}]/.test(tail)) throw badRequest('INVALID_TEMPLATE', 'chave não fechada')
  if (tail) out.push({ lit: tail })
  return out
}

/** Gravação (PUT /announce/events/:type). Lança AppError; nunca salva quebrado. */
export function validateTemplate (template, eventType, agg = false) {
  if (template == null || template === '') return null   // §5: vazio = desligado
  if (cps(template).length > MAX_TEMPLATE) {
    throw badRequest('TEMPLATE_TOO_LONG', `máximo ${MAX_TEMPLATE} caracteres`)
  }
  const known = varsFor(eventType, agg)
  for (const t of parse(template)) {
    if (t.v && !known.has(t.v)) throw badRequest('UNKNOWN_VARIABLE', `{${t.v}} não existe em ${eventType}`)
  }
  return template
}

// R18: sem quebra de linha, sem caractere de controle, sem tags Unicode
// (U+E0000-U+E007F carregam texto invisível), runs de espaço colapsados.
// RegExp por string para não deixar byte de controle solto no fonte.
const CONTROL = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g')
const UNICODE_TAGS = new RegExp('[\\u{E0000}-\\u{E007F}]', 'gu')

export function sanitize (value) {
  if (value == null) return ''                                   // §5: nula → vazio
  const s = typeof value === 'number' ? value.toLocaleString('pt-BR') : String(value)
  return s.replace(CONTROL, ' ').replace(UNICODE_TAGS, '').replace(/\s+/g, ' ').trim()
}

export function render (template, vars) {
  return parse(template).map(t => (t.lit ?? sanitize(vars[t.v]))).join('')
}

/** R13 + R18, aplicados só uma vez, no fim. */
export function finalize (message) {
  // Anti-comando: nome de guilda não vira /ban.
  let m = /^[/.]/.test(message) ? ZWSP + message : message
  const c = cps(m)
  if (c.length > MAX_MESSAGE) m = c.slice(0, MAX_MESSAGE - 1).join('') + '…'
  return m
}

/** §5, agregado: até 3 nomes + "e mais N". */
export function listOf (names) {
  const n = names.map(sanitize).filter(Boolean)
  return n.length <= 3 ? n.join(', ') : `${n.slice(0, 3).join(', ')} e mais ${n.length - 3}`
}

/**
 * Render de runtime com a cascata de fallback da §5 / R17:
 * template do streamer → template padrão → `[{tag}] {evento}`.
 * Nunca lança: deixar de entregar por template quebrado é pior que a mensagem feia.
 */
export function renderMessage ({ eventType, template, vars, agg = false }) {
  const fallback = (agg ? DEFAULT_TEMPLATES_AGG : DEFAULT_TEMPLATES)[eventType]
  const tries = [template, fallback].filter(t => t != null && t !== '')
  for (let i = 0; i < tries.length; i++) {
    try {
      return { message: finalize(render(tries[i], vars)), fallbackUsed: i > 0 }
    } catch { /* próxima da cascata */ }
  }
  return { message: finalize(`[${sanitize(vars.tag)}] ${eventType}`), fallbackUsed: true }
}
