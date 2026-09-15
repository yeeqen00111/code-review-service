import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Context } from 'hono'

/**
 * The error type system: request-scoped `ApiError` carries an HTTP status and
 * the wire code from docs/api-contract.md; task-scoped `TaskFailure` codes are
 * recorded on the task instead of returned to the caller. Every error renders
 * the shared envelope `{ error: { code, message, details } }`.
 */

/** Wire codes for request-scoped failures, with their HTTP status. */
export const API_ERROR_STATUS = {
  VALIDATION_FAILED: 400,
  REPO_NOT_WHITELISTED: 400,
  REPO_NOT_FOUND: 400,
  BRANCH_NOT_FOUND: 400,
  PREV_REPORT_CONFLICT: 400,
  TASK_ID_CONFLICT: 400,
  TASK_NOT_FOUND: 404,
  REPORT_NOT_READY: 409,
  QUEUE_BUSY: 429,
} as const

export type ApiErrorCode = keyof typeof API_ERROR_STATUS

/**
 * Request-scoped error. Thrown by route handlers and validation; rendered by
 * {@link handleApiError} into the contract's error envelope.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(code: ApiErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = API_ERROR_STATUS[code]
    this.details = details
  }
}

/** Task-scoped failure codes; recorded on the task, never thrown at request time. */
export const TASK_FAILURE_CODES = [
  'GIT_SYNC_FAILED',
  'REVIEW_TIMEOUT',
  'HARNESS_CRASHED',
  'ISSUES_PARSE_FAILED',
] as const

export type TaskFailureCode = (typeof TASK_FAILURE_CODES)[number]

/** Type guard distinguishing the codes that may be recorded on a task. */
export function isTaskFailureCode(code: string): code is TaskFailureCode {
  return (TASK_FAILURE_CODES as readonly string[]).includes(code)
}

/** The contract's error envelope body. */
export interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> }
}

/** Render one error as the envelope; unknown errors degrade to a 500 INTERNAL. */
export function toEnvelope(error: unknown): { body: ErrorEnvelope; status: number } {
  if (error instanceof ApiError) {
    return {
      body: { error: { code: error.code, message: error.message, details: error.details } },
      status: error.status,
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return {
    body: { error: { code: 'INTERNAL', message, details: {} } },
    status: 500,
  }
}

/** Hono error-handler hook: mounts once on the app, renders every throw. */
export function handleApiError(error: unknown, c: Context): Response {
  const { body, status } = toEnvelope(error)
  return c.json(body, status as ContentfulStatusCode)
}
