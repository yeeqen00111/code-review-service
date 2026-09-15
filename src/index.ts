import { serve } from '@hono/node-server'

/** Application port; the config module (T0.2) will own this value later. */
const DEFAULT_PORT = 3120

/**
 * Boot the HTTP server. Kept separate from module top-level so tests import
 * the app without opening a port; index.ts owns the process lifecycle only.
 */
export function main(): void {
  const port = Number(process.env.PORT ?? DEFAULT_PORT)
  // Placeholder bootstrap; routes arrive in T4.3, config in T0.2.
  import('./app.js').then(({ createApp }) => {
    serve({ fetch: createApp().fetch, port }, (info) => {
      console.log(`code-review-service listening on http://127.0.0.1:${info.port}`)
    })
  })
}

main()
