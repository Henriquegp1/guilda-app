import { EVENT_TYPES } from '../../core/events.js'

/**
 * Catálogo fechado da fase 07 §3. Cada chave é um `guild_event.type` 1:1.
 *
 * `onCooldown` vem da tabela de cooldown da §6 e é a única fonte de
 * agregabilidade — a linha "prioridade alta nunca agrega" da §3 contradiz a
 * própria §6 (`guild.approved` é alta e agrega) e os critérios de aceite
 * ("10 guild.approved em 5 min → 1 mensagem"), então a tabela específica manda.
 *
 * `ranking.top1_changed` e `ranking.top3_entered` estão na §3 mas NÃO existem em
 * docs/EVENTOS.md nem em EVENT_TYPES (risco D1). Ficam fora até a fase 04
 * registrá-los; a mecânica que eles exigiam (`onCooldown: 'ultimo'` → superseded)
 * está implementada e testada, então voltar é uma linha aqui.
 */
export const CATALOG = {
  'guild.approved':       { priority: 'alta',  cooldownS: 120,  onCooldown: 'agrega',   enabled: true,  vars: [] },
  'guild.level_up':       { priority: 'media', cooldownS: 300,  onCooldown: 'agrega',   enabled: true,  vars: ['nivel_anterior', 'desbloqueio'] },
  'war.declared':         { priority: 'alta',  cooldownS: 180,  onCooldown: 'agrega',   enabled: true,  vars: ['oponente', 'tag_oponente', 'duracao'] },
  'war.accepted':         { priority: 'media', cooldownS: 300,  onCooldown: 'agrega',   enabled: true,  vars: ['oponente', 'tag_oponente', 'duracao'] },
  'war.ended':            { priority: 'alta',  cooldownS: 120,  onCooldown: 'agrega',   enabled: true,  vars: ['oponente', 'tag_oponente', 'vencedor', 'placar'] },
  'territory.captured':   { priority: 'media', cooldownS: 300,  onCooldown: 'agrega',   enabled: true,  vars: ['territorio', 'dono_anterior'] },
  'achievement.unlocked': { priority: 'baixa', cooldownS: 900,  onCooldown: 'agrega',   enabled: false, vars: ['conquista', 'raridade'] },
  'season.started':       { priority: 'alta',  cooldownS: 3600, onCooldown: 'descarta', enabled: true,  vars: ['temporada', 'termina_em'] },
  'season.ended':         { priority: 'alta',  cooldownS: 3600, onCooldown: 'descarta', enabled: true,  vars: ['temporada', 'primeiro', 'segundo', 'terceiro'] },
  'guild.recruiting':     { priority: 'baixa', cooldownS: 1800, onCooldown: 'descarta', enabled: false, vars: ['vagas', 'modo'] },
  'ranking.top1_changed': { priority: 'alta',  cooldownS: 600,  onCooldown: 'ultimo',   enabled: true,  vars: ['tag', 'tag_anterior'] },
  'ranking.top3_entered': { priority: 'media', cooldownS: 600,  onCooldown: 'ultimo',   enabled: true,  vars: ['tag'] },
}

// Erro de programação, não de runtime: falha no import se alguém acrescentar um
// tipo que não está em docs/EVENTOS.md.
for (const type of Object.keys(CATALOG)) {
  if (!EVENT_TYPES.has(type)) {
    throw new Error(`announce: ${type} não está em EVENT_TYPES — registre em docs/EVENTOS.md`)
  }
}
// R3: guild.created nunca é anunciável. O gatilho público é guild.approved.
if ('guild.created' in CATALOG) throw new Error('announce: guild.created viola R3')

export const isAggregable = (type) => CATALOG[type]?.onCooldown === 'agrega'

/** §5: só raridade epic/legendary entra na fila. */
export const passesCatalogFilter = (type, payload = {}) =>
  type !== 'achievement.unlocked' || ['epic', 'legendary'].includes(payload.rarity)

export const COMMON_VARS = ['guilda', 'tag', 'lider', 'nivel', 'prestigio', 'membros', 'canal']
export const AGG_VARS = ['quantidade', 'lista']

export const varsFor = (type, agg = false) =>
  new Set([...COMMON_VARS, ...(CATALOG[type]?.vars ?? []), ...(agg ? AGG_VARS : [])])

export const DEFAULT_TEMPLATES = {
  'guild.approved':       '⚔️ NOVA GUILDA CRIADA! {lider} fundou {guilda} [{tag}] — a guilda está recrutando novos membros!',
  'guild.level_up':       '📈 {guilda} [{tag}] subiu para o nível {nivel}! Desbloqueou: {desbloqueio}.',
  'war.declared':         '⚔️ {guilda} [{tag}] declarou guerra a {oponente} [{tag_oponente}]! Duração: {duracao}.',
  'war.accepted':         '🛡️ {guilda} [{tag}] aceitou a guerra contra {oponente} [{tag_oponente}]!',
  'war.ended':            '🏁 Guerra encerrada: {vencedor} venceu! {guilda} [{tag}] x {oponente} [{tag_oponente}] — {placar}.',
  'territory.captured':   '🗺️ {guilda} [{tag}] conquistou {territorio}, antes de {dono_anterior}!',
  'achievement.unlocked': '🏅 {guilda} [{tag}] desbloqueou a conquista {conquista} ({raridade})!',
  'season.started':       '🚩 Temporada {temporada} começou! Termina em {termina_em}. Boa sorte, guildas!',
  'season.ended':         '🏁 Temporada {temporada} encerrada! 🥇 {primeiro} 🥈 {segundo} 🥉 {terceiro}',
  'guild.recruiting':     '📣 {guilda} [{tag}] está recrutando! {vagas} vagas, entrada {modo}.',
  'ranking.top1_changed': '👑 {tag} assumiu o TOP 1 do ranking, ultrapassando {tag_anterior}!',
  'ranking.top3_entered': '🏆 {tag} entrou para o TOP 3 do ranking! A disputa está acirrada.',
}

export const DEFAULT_TEMPLATES_AGG = {
  'guild.approved':       '⚔️ {quantidade} novas guildas nasceram: {lista}. Abra a extensão para entrar em uma!',
  'guild.level_up':       '📈 {quantidade} guildas subiram de nível: {lista}.',
  'war.declared':         '⚔️ {quantidade} guerras declaradas: {lista}.',
  'war.accepted':         '🛡️ {quantidade} guerras aceitas: {lista}.',
  'war.ended':            '🏁 {quantidade} guerras encerradas: {lista}.',
  'territory.captured':   '🗺️ {quantidade} territórios mudaram de dono: {lista}.',
  'achievement.unlocked': '🏅 {quantidade} conquistas desbloqueadas: {lista}.',
}
