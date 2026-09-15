import { Hono } from 'hono'
import { handleApiError } from './routes/errors.js'

/**
 * Root Hono application. Route modules mount here as they land
 * (reviews routes in T4.3). The error handler renders the contract's
 * envelope for every throw. Health endpoint proves the stack end to end.
 */
export function createApp(): Hono {
  const app = new Hono()
  app.onError(handleApiError)
  app.get('/healthz', (c) => c.json({ ok: true }))
  return app
}
