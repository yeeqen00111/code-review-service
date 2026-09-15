import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { ApiError, API_ERROR_STATUS, isTaskFailureCode, TASK_FAILURE_CODES, toEnvelope } from '../src/routes/errors.js'

describe('ApiError', () => {
  it('carries the contract status for every code', () => {
    expect(new ApiError('VALIDATION_FAILED', 'x').status).toBe(400)
    expect(new ApiError('TASK_NOT_FOUND', 'x').status).toBe(404)
    expect(new ApiError('REPORT_NOT_READY', 'x').status).toBe(409)
    expect(new ApiError('QUEUE_BUSY', 'x').status).toBe(429)
    expect(API_ERROR_STATUS.REPO_NOT_WHITELISTED).toBe(400)
  })

  it('preserves details', () => {
    const e = new ApiError('REPO_NOT_WHITELISTED', 'nope', { repoPath: 'D:/x' })
    expect(e.details).toEqual({ repoPath: 'D:/x' })
  })
})

describe('toEnvelope', () => {
  it('renders ApiError with its code and status', () => {
    const { body, status } = toEnvelope(new ApiError('TASK_ID_CONFLICT', 'dup'))
    expect(status).toBe(400)
    expect(body).toEqual({ error: { code: 'TASK_ID_CONFLICT', message: 'dup', details: {} } })
  })

  it('degrades unknown errors to a 500 INTERNAL with the original message', () => {
    const { body, status } = toEnvelope(new Error('boom'))
    expect(status).toBe(500)
    expect(body.error.code).toBe('INTERNAL')
    expect(body.error.message).toBe('boom')
  })

  it('stringifies non-Error throws', () => {
    expect(toEnvelope('weird').body.error.message).toBe('weird')
  })
})

describe('task failure codes', () => {
  it('accepts exactly the contract codes', () => {
    for (const code of TASK_FAILURE_CODES) expect(isTaskFailureCode(code)).toBe(true)
    expect(isTaskFailureCode('VALIDATION_FAILED')).toBe(false)
    expect(isTaskFailureCode('MADE_UP')).toBe(false)
  })
})

describe('handleApiError', () => {
  it('renders thrown ApiErrors when mounted via app.onError', async () => {
    const app = createApp()
    app.get('/boom', () => {
      throw new ApiError('VALIDATION_FAILED', 'teapot')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: { code: 'VALIDATION_FAILED', message: 'teapot', details: {} } })
  })

  it('renders unknown throws as INTERNAL', async () => {
    const app = createApp()
    app.get('/crash', () => {
      throw new Error('boom')
    })
    const res = await app.request('/crash')
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INTERNAL')
  })
})
