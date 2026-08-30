/** Erro de domínio. Vira `{ error: { code, message } }` (ARQUITETURA §Convenções de API). */
export class AppError extends Error {
  constructor (status, code, message, data = null) {
    super(message ?? code)
    this.status = status
    this.code = code
    this.data = data
  }
}

export const badRequest = (code, msg, data) => new AppError(400, code, msg, data)
export const forbidden = (code, msg, data) => new AppError(403, code, msg, data)
export const notFound = (code, msg, data) => new AppError(404, code, msg, data)
export const conflict = (code, msg, data) => new AppError(409, code, msg, data)

/** Mapeia violação de constraint para o código de domínio informado. */
export function onUnique (constraint, code, message) {
  return (err) => {
    if (err.code === '23505' && err.constraint === constraint) throw conflict(code, message)
    throw err
  }
}

export function errorHandler (err, req, reply) {
  if (err instanceof AppError) {
    return reply.code(err.status)
      .send({ error: { code: err.code, message: err.message, ...(err.data ?? {}) } })
  }
  req.log.error(err)
  return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal error' } })
}
