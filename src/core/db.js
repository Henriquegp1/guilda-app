import pg from 'pg'

// bigint como number: nenhum id nosso chega perto de 2^53.
pg.types.setTypeParser(20, Number)

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://localhost/twitch_guilds',
})

export const query = (text, params) => pool.query(text, params)

/**
 * Roda fn dentro de uma transação. Commit no retorno, rollback na exceção.
 * Praticamente toda escrita deste projeto é transacional: evento + estado
 * mudam juntos ou não mudam (ARQUITETURA, guild_event é o eixo).
 */
export async function tx (fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
