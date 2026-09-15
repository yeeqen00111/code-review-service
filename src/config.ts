import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * Configuration loading for the review service. Two sources, validated once:
 * `config.yaml` (non-sensitive settings) and `.env` (secrets). All problems are
 * collected and reported together — the service refuses to boot on any of them
 * (fail loud, never skip a missing referent).
 */

/** Aggregated configuration failure; `problems` lists every defect found. */
export class ConfigError extends Error {
  readonly problems: readonly string[]

  constructor(problems: readonly string[]) {
    super(`configuration invalid (${problems.length} problem(s))`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}

const yamlSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  harness: z
    .object({
      profile: z.string().min(1).default('sdk'),
      dshBin: z.string().min(1).optional(),
      initializeTimeoutMs: z.number().int().min(1000).max(120_000).default(10_000),
    })
    // zod `.default(value)` returns the value verbatim without parsing, so the
    // full object is spelled out here; inner defaults apply on explicit partial input.
    .default({ profile: 'sdk', initializeTimeoutMs: 10_000 }),
  repoWhitelist: z.array(z.string().min(1)).min(1),
  baseBranch: z.string().min(1).default('main'),
  globalSpecPath: z.string().min(1),
  reviewTimeoutMin: z.number().int().min(1).max(120).default(15),
  reportsDirName: z.string().min(1).default('.reviews'),
  prevReportMaxBytes: z.number().int().positive().default(5 * 1024 * 1024),
  requirementsMaxChars: z.number().int().positive().default(2000),
  port: z.number().int().min(1).max(65_535).default(3120),
  concurrency: z.number().int().min(1).default(1),
  reportRetentionDays: z.number().int().min(1).default(90),
})

/** Validated non-sensitive settings, with defaults applied and paths normalized. */
export interface AppConfig {
  provider: string
  model: string
  harness: { profile: string; dshBin?: string; initializeTimeoutMs: number }
  /** Normalized whitelist entries (lowercase, forward slashes, no trailing slash). */
  repoWhitelist: readonly string[]
  baseBranch: string
  /** As configured (may be relative); see {@link globalSpecPathAbsolute} for the checked path. */
  globalSpecPath: string
  globalSpecPathAbsolute: string
  reviewTimeoutMin: number
  reportsDirName: string
  prevReportMaxBytes: number
  requirementsMaxChars: number
  port: number
  concurrency: number
  reportRetentionDays: number
}

/** Secrets from `.env` / process environment. Never logged, never serialized into reports. */
export interface HarnessSecrets {
  deepseekApiKey: string
  deepseekBaseUrl?: string
  gitAccessToken?: string
}

export interface LoadedConfig {
  config: AppConfig
  secrets: HarnessSecrets
}

/**
 * Normalize a path for prefix comparison: backslashes to forward slashes,
 * trailing slashes stripped, lowercased (Windows paths are case-insensitive;
 * lowercasing is harmless where they are not).
 */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * Whether `candidate` is an absolute path under (or equal to) one whitelist
 * entry. Prefix matching is segment-safe: `D:/work/project-evil` does not
 * match a `D:/work/project` entry.
 */
export function isPathWhitelisted(whitelist: readonly string[], candidate: string): boolean {
  if (!isAbsolute(candidate)) return false
  const c = normalizePath(candidate)
  return whitelist.some((entry) => {
    const n = normalizePath(entry)
    return c === n || c.startsWith(`${n}/`)
  })
}

/** Parse `.env` content: `KEY=VALUE` lines, `#` comments, quoted values unquoted. */
export function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    if (quoted) value = value.slice(1, -1)
    if (key.length > 0) out[key] = value
  }
  return out
}

export interface LoadConfigOptions {
  /** Defaults to `config.yaml` in the current working directory. */
  configPath?: string
  /** Defaults to `.env` in the current working directory; absent file is fine. */
  envPath?: string
  /** Process environment; real `process.env` wins over `.env` values. */
  processEnv?: NodeJS.ProcessEnv
}

/**
 * Load and validate the full configuration. Throws {@link ConfigError} with
 * every problem found; returns typed settings plus secrets on success.
 */
export function loadConfig(options: LoadConfigOptions = {}): LoadedConfig {
  const problems: string[] = []
  const configPath = options.configPath ?? 'config.yaml'
  const envPath = options.envPath ?? '.env'
  const processEnv = options.processEnv ?? process.env

  // ── config.yaml ──────────────────────────────────────────────────────────
  let parsed: AppConfig | undefined
  if (!existsSync(configPath)) {
    problems.push(`config file not found: ${configPath}`)
  } else {
    let raw: unknown
    try {
      raw = parseYaml(readFileSync(configPath, 'utf8'))
    } catch (error) {
      raw = undefined
      problems.push(`config file is not valid YAML: ${(error as Error).message}`)
    }
    if (raw !== undefined) {
      const result = yamlSchema.safeParse(raw)
      if (!result.success) {
        for (const issue of result.error.issues) {
          problems.push(`config field '${issue.path.join('.') || '<root>'}': ${issue.message}`)
        }
      } else {
        // Relative config paths resolve against the config file's directory,
        // not the process cwd, so a relocated config.yaml stays self-consistent.
        parsed = toAppConfig(result.data, problems, dirname(resolve(configPath)))
      }    }
  }

  // ── secrets (.env overlaid by process env) ──────────────────────────────
  const secrets: HarnessSecrets = { deepseekApiKey: '' }
  const fileEnv = existsSync(envPath) ? parseDotenv(readFileSync(envPath, 'utf8')) : {}
  const env = (key: string): string | undefined => processEnv[key] ?? fileEnv[key]
  const apiKey = env('DEEPSEEK_API_KEY')
  if (apiKey === undefined || apiKey.length === 0) {
    problems.push(`env DEEPSEEK_API_KEY is required (set it in ${envPath} or the environment)`)
  } else {
    secrets.deepseekApiKey = apiKey
  }
  const baseUrl = env('DEEPSEEK_BASE_URL')
  if (baseUrl !== undefined && baseUrl.length > 0) secrets.deepseekBaseUrl = baseUrl
  const gitToken = env('GIT_ACCESS_TOKEN')
  if (gitToken !== undefined && gitToken.length > 0) secrets.gitAccessToken = gitToken

  if (problems.length > 0 || parsed === undefined) throw new ConfigError(problems)
  return { config: parsed, secrets }
}

/** Post-schema validation that zod cannot express: path shape and existence. */
function toAppConfig(
  data: z.infer<typeof yamlSchema>,
  problems: string[],
  configDir: string,
): AppConfig | undefined {
  for (const entry of data.repoWhitelist) {
    if (!isAbsolute(entry)) problems.push(`config field 'repoWhitelist': entry is not an absolute path: ${entry}`)
  }
  const globalSpecPathAbsolute = resolve(configDir, data.globalSpecPath)
  if (!existsSync(globalSpecPathAbsolute)) {
    problems.push(`config field 'globalSpecPath': file not found: ${globalSpecPathAbsolute}`)
  }
  if (problems.length > 0) return undefined
  return {
    ...data,
    // Rebuild `harness` explicitly: zod infers `dshBin?: string | undefined`,
    // which `exactOptionalPropertyTypes` rejects for `dshBin?: string`.
    harness: {
      profile: data.harness.profile,
      initializeTimeoutMs: data.harness.initializeTimeoutMs,
      ...(data.harness.dshBin !== undefined ? { dshBin: data.harness.dshBin } : {}),
    },
    repoWhitelist: data.repoWhitelist.map(normalizePath),
    globalSpecPathAbsolute,
  }
}
