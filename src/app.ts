import { Hono } from 'hono'

/**
 * Root Hono application. Route modules mount here as they land
 * (reviews routes in T4.3). Health endpoint proves the stack end to end.
 */
export function createApp(): Hono {
  const app = new Hono()
  app.get('/healthz', (c) => c.json({ ok: true }))
  return app
}
