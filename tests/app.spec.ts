import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'

describe('healthz', () => {
  it('responds ok', async () => {
    const res = await createApp().request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
