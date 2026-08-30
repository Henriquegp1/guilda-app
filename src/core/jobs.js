/**
 * Agendador dos jobs periódicos dos módulos. Cada fase exporta a função que faz
 * uma passada; quem decide o intervalo é aqui, num lugar só.
 *
 * ponytail: setInterval em processo. Serve para uma instância; com duas, cada uma
 * roda tudo. Trocar por BullMQ (Redis já está na stack) quando o EBS escalar
 * horizontalmente ou quando um job passar a doer se rodar duas vezes.
 */
import { tx, query } from './db.js'

const MIN = 60_000

/**
 * `needs` diz o que a função do módulo espera receber, porque as fases divergiram:
 *   'nothing'  fn()                        — abre a própria conexão
 *   'client'   fn(client)                  — roda dentro de uma transação nossa
 *   'channel'  fn(client, { channelId })   — uma passada por canal
 * Chamar com a forma errada só produzia exceção capturada e log eterno.
 */
export const JOBS = [
  { name: 'guilds.reaper', everyMs: MIN, needs: 'nothing', load: () => import('../modules/guilds/index.js'), fn: 'reapExpiredDrafts' },
  { name: 'members.expireStale', everyMs: 10 * MIN, needs: 'client', load: () => import('../modules/members/index.js'), fn: 'expireStale' },
  { name: 'members.succession', everyMs: 60 * MIN, needs: 'client', load: () => import('../modules/members/index.js'), fn: 'runSuccession' },
  { name: 'members.purgeEmpty', everyMs: 60 * MIN, needs: 'client', load: () => import('../modules/members/index.js'), fn: 'purgeEmpty' },
  { name: 'identity.revoked', everyMs: 60 * MIN, needs: 'channel', load: () => import('../modules/identity/index.js'), fn: 'reconcileRevokedEmblems' },
  { name: 'announce.ingest', everyMs: 15_000, needs: 'nothing', load: () => import('../modules/announce/index.js'), fn: 'ingestOnce' },
  { name: 'announce.flush', everyMs: 30_000, needs: 'nothing', load: () => import('../modules/announce/index.js'), fn: 'flushAggregates' },
  { name: 'announce.dispatch', everyMs: 10_000, needs: 'nothing', load: () => import('../modules/announce/index.js'), fn: 'processOutboxOnce' },
  { name: 'xp.ingest', everyMs: 15_000, needs: 'nothing', load: () => import('../modules/xp/index.js'), fn: 'ingestXpOnce' },
  { name: 'xp.snapshot', everyMs: 60 * MIN, needs: 'nothing', load: () => import('../modules/xp/index.js'), fn: 'snapshotDaily' },
  { name: 'xp.reconcile', everyMs: 7 * 24 * 60 * MIN, needs: 'nothing', load: () => import('../modules/xp/index.js'), fn: 'reconcileXp' },
  { name: 'seasons.ingest', everyMs: 15_000, needs: 'nothing', load: () => import('../modules/seasons/index.js'), fn: 'ingestPrestigeOnce' },
  { name: 'seasons.snapshot', everyMs: MIN, needs: 'nothing', load: () => import('../modules/seasons/index.js'), fn: 'snapshotRankings' },
  { name: 'seasons.lifecycle', everyMs: MIN, needs: 'nothing', load: () => import('../modules/seasons/index.js'), fn: 'runSeasonLifecycle' },
  { name: 'seasons.achievements', everyMs: 5 * MIN, needs: 'nothing', load: () => import('../modules/seasons/index.js'), fn: 'ingestAchievementsOnce' },
  { name: 'seasons.weekly', everyMs: 60 * MIN, needs: 'nothing', load: () => import('../modules/seasons/index.js'), fn: 'runWeeklyObjectives' },
  { name: 'wars.ingest', everyMs: 15_000, needs: 'nothing', load: () => import('../modules/wars/index.js'), fn: 'ingestWarPointsOnce' },
  { name: 'wars.lifecycle', everyMs: MIN, needs: 'nothing', load: () => import('../modules/wars/index.js'), fn: 'runWarLifecycle' },
  { name: 'wars.territory', everyMs: 5 * MIN, needs: 'nothing', load: () => import('../modules/wars/index.js'), fn: 'runTerritoryCycle' },
  // wars.board só entra quando existir transporte PubSub de verdade; hoje
  // `publishBoard` é stub e `GET /wars/active` devolve o mesmo shape.
]

async function runJob (job, fn) {
  if (job.needs === 'nothing') return fn()
  if (job.needs === 'client') return tx(fn)
  const { rows } = await query('SELECT id FROM channel')
  for (const { id } of rows) await tx(c => fn(c, { channelId: id }))
}

/**
 * Uma passada falhando nunca derruba o processo nem para as próximas: job de
 * limpeza que morre em silêncio é pior que job que loga e tenta de novo.
 */
export function startJobs ({ log = console, only = null } = {}) {
  const timers = []

  for (const job of JOBS) {
    if (only && !only.includes(job.name)) continue

    const tick = async () => {
      try {
        const mod = await job.load()
        const fn = mod[job.fn]
        if (typeof fn !== 'function') {
          log.warn?.({ job: job.name }, 'job registrado mas não exportado')
          return
        }
        await runJob(job, fn)
      } catch (err) {
        log.error?.({ err, job: job.name }, 'job falhou') ?? log.error(job.name, err)
      }
    }

    const t = setInterval(tick, job.everyMs)
    t.unref()
    timers.push(t)
  }

  return () => timers.forEach(clearInterval)
}
