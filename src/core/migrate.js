import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool, tx } from './db.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

/**
 * Roda os .sql de migrations/ em ordem alfabética, uma transação por arquivo.
 * Numeração reservada por fase (ver README §Código): 000 core, 010 guilds,
 * 020 members, 030 xp, 040 seasons, 050 wars, 060 identity, 070 announce.
 */
export async function migrate (log = console.log) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

  const { rows } = await pool.query('SELECT filename FROM schema_migration')
  const done = new Set(rows.map(r => r.filename))
  const files = (await readdir(DIR)).filter(f => f.endsWith('.sql')).sort()

  const applied = []
  for (const file of files) {
    if (done.has(file)) continue
    const sql = await readFile(join(DIR, file), 'utf8')
    await tx(async (c) => {
      await c.query(sql)
      await c.query('INSERT INTO schema_migration (filename) VALUES ($1)', [file])
    })
    log(`aplicada ${file}`)
    applied.push(file)
  }
  if (!applied.length) log('nada a aplicar')
  return applied
}

if (import.meta.filename === process.argv[1]) {
  await migrate()
  await pool.end()
}
