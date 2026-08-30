/**
 * A extensão roda em `https://<client-id>.ext-twitch.tv`, então toda chamada ao
 * EBS é cross-origin. Sem isto o navegador barra tudo no preflight e o viewer
 * só vê "sem conexão" — o backend nem chega a ser exercitado.
 *
 * Lista fechada por padrão: reflete só origem conhecida, nunca `*`. Com
 * `Authorization` em jogo, `*` seria abrir o EBS para qualquer página.
 */
const TWITCH = /^https:\/\/[a-z0-9]+\.ext-twitch\.tv$/

const extras = () =>
  (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

export const origemPermitida = (origem) =>
  !!origem && (TWITCH.test(origem) || extras().includes(origem))

export function cors (app) {
  app.addHook('onRequest', async (req, reply) => {
    const origem = req.headers.origin
    if (!origemPermitida(origem)) return

    reply.headers({
      'access-control-allow-origin': origem,
      // A resposta muda conforme a origem; sem isto um proxy serve a errada.
      vary: 'Origin',
      'access-control-allow-headers': 'authorization, content-type, x-actor-user-id',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'access-control-max-age': '86400',
    })

    if (req.method === 'OPTIONS') reply.code(204).send()
  })
}
