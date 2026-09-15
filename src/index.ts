import { serve } from '@hono/node-server'
import { ConfigError, loadConfig } from './config.js'

/**
 * Boot the service: fail loud on configuration problems, then serve.
 * Kept as a function (not module top-level work) so tests import modules
 * without process side effects.
 */
export function main(): void {
  let port: number
  try {
    const { config } = loadConfig()
    port = config.port
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`configuration invalid:\n${error.problems.map((p) => `  - ${p}`).join('\n')}`)
      process.exitCode = 1
      return
    }
    throw error
  }
  // Route modules mount in createApp as they land (reviews routes in T4.3).
  import('./app.js').then(({ createApp }) => {
    serve({ fetch: createApp().fetch, port }, (info) => {
      console.log(`code-review-service listening on http://127.0.0.1:${info.port}`)
    })
  })
}

main()
