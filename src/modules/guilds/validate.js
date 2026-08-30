import { AppError, badRequest } from '../../core/errors.js'

// R1: 3–24, [A-Za-z0-9 ], sem espaço nas pontas (o `  ` duplo é checado à parte
// porque regex de repetição não expressa isso sem ficar ilegível).
const NAME_RE = /^[A-Za-z0-9]([A-Za-z0-9 ]{1,22}[A-Za-z0-9])$/
const TAG_RE = /^[A-Z0-9]{2,5}$/
const COLOR_RE = /^#[0-9A-F]{6}$/

/** Placeholder da fase 01: catálogo fixo, sem editor. A fase 06 substitui. */
export const EMBLEM_PRESETS = [
  'shield', 'sword', 'crown', 'wolf', 'dragon', 'skull', 'star', 'anvil',
]

export function validateName (name) {
  if (typeof name !== 'string' || !NAME_RE.test(name) || name.includes('  ')) {
    throw badRequest('GUILD_NAME_INVALID',
      'nome: 3–24 caracteres [A-Za-z0-9 ], sem espaço nas pontas nem espaço duplo')
  }
  return name
}

/** R2: normaliza para maiúscula antes de gravar. */
export function validateTag (tag) {
  const up = typeof tag === 'string' ? tag.toUpperCase() : ''
  if (!TAG_RE.test(up)) throw badRequest('GUILD_TAG_INVALID', 'TAG: 2–5 caracteres [A-Z0-9]')
  return up
}

export function validateColor (value, field) {
  const up = typeof value === 'string' ? value.toUpperCase() : ''
  if (!COLOR_RE.test(up)) throw badRequest('VALIDATION_ERROR', `${field}: use #RRGGBB`)
  return up
}

export function validateText (value, max, field) {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > max) {
    throw badRequest('VALIDATION_ERROR', `${field}: texto de no máximo ${max} caracteres`)
  }
  return value
}

export function validateEmblem (preset) {
  if (preset == null) return null
  if (!EMBLEM_PRESETS.includes(preset)) {
    throw badRequest('VALIDATION_ERROR', `emblem_preset: use um de ${EMBLEM_PRESETS.join(', ')}`)
  }
  return preset
}

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' }

/**
 * R4: minúscula, sem acento, leetspeak revertido, sem separadores.
 * NFD separa o acento da letra e o filtro final [^a-z] leva o acento junto.
 */
export function normalizeForDenylist (value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[013457]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '')
}

export const GLOBAL_DENYLIST = [
  'admin', 'mod', 'moderador', 'staff', 'twitch', 'oficial',
  'nazi', 'nazista', 'hitler', 'kkk',
  'porra', 'caralho', 'buceta', 'viado', 'puta', 'merda', 'cuzao',
  'fuck', 'shit', 'cunt', 'nigger', 'nigga', 'faggot', 'rape', 'estupro',
  'pedofilo', 'suicidio',
].map(normalizeForDenylist)

/**
 * R4: match na forma normalizada. Termo curto casa só inteiro; a partir de 4
 * letras casa como substring, para pegar sufixo ("nazistas").
 * ponytail: substring gera falso positivo (repuTAção contém "puta"). Aceito —
 * a moderação humana é a defesa real (doc §8, risco 5); trocar por lista de
 * regex com fronteira se virar reclamação.
 */
export function checkDenylist (value, extra = []) {
  const norm = normalizeForDenylist(value)
  const words = [...GLOBAL_DENYLIST, ...(Array.isArray(extra) ? extra : []).map(normalizeForDenylist)]
  const hit = words.find((w) => w && (w.length >= 4 ? norm.includes(w) : norm === w))
  if (hit) throw new AppError(422, 'GUILD_NAME_FORBIDDEN', `termo bloqueado: ${hit}`)
}

/**
 * Valida só os campos presentes no body — serve tanto o POST quanto os PATCH.
 * Chave ausente = não mexe; `null` em emblem_preset = remove.
 */
export function parseForm (body, settings = {}) {
  const out = {}
  const deny = settings.name_denylist ?? []
  if ('name' in body) {
    out.name = validateName(body.name)
    checkDenylist(out.name, deny)
  }
  if ('tag' in body) {
    out.tag = validateTag(body.tag)
    checkDenylist(out.tag, deny)
  }
  if ('description' in body) out.description = validateText(body.description, 280, 'description')
  if ('motto' in body) out.motto = validateText(body.motto, 80, 'motto')
  if ('color_primary' in body) out.color_primary = validateColor(body.color_primary, 'color_primary')
  if ('color_secondary' in body) out.color_secondary = validateColor(body.color_secondary, 'color_secondary')
  if ('emblem_preset' in body) out.emblem_preset = validateEmblem(body.emblem_preset)
  return out
}
