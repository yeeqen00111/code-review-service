import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError, isPathWhitelisted, loadConfig, normalizePath, parseDotenv } from '../src/config.js'

/** Minimal valid yaml content; overrides are deep-merged over the base. */
const validYaml = (overrides: Record<string, unknown> = {}): string => {
  const base: Record<string, unknown> = {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    repoWhitelist: ['D:/work/project'],
    globalSpecPath: './spec.md',
  }
  return stringifyYaml({ ...base, ...overrides })
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'crs-config-'))
  writeFileSync(join(dir, 'spec.md'), '# global spec\n')
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeEnv(extra: Record<string, string> = {}): void {
  const lines = ['DEEPSEEK_API_KEY=test-key', ...Object.entries(extra).map(([k, v]) => `${k}=${v}`)]
  writeFileSync(join(dir, '.env'), `${lines.join('\n')}\n`)
}

function load(overrides: Record<string, unknown> = {}, env: Record<string, string> = {}): ReturnType<typeof loadConfig> {
  writeFileSync(join(dir, 'config.yaml'), `${validYaml(overrides)}\n`)
  writeEnv(env)
  return loadConfig({
    configPath: join(dir, 'config.yaml'),
    envPath: join(dir, '.env'),
    processEnv: {},
  })
}

/** Assert `fn` throws ConfigError whose problems contain every substring. */
function expectProblems(fn: () => unknown, ...substrings: string[]): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError)
    const problems = (error as ConfigError).problems.join('\n')
    for (const s of substrings) expect(problems).toContain(s)
    return
  }
  expect.fail('expected ConfigError but loadConfig succeeded')
}

describe('loadConfig', () => {
  it('accepts a valid config and applies defaults', () => {
    const { config, secrets } = load()
    expect(config.provider).toBe('deepseek-official')
    expect(config.harness.profile).toBe('sdk')
    expect(config.harness.initializeTimeoutMs).toBe(10_000)
    expect(config.baseBranch).toBe('main')
    expect(config.reviewTimeoutMin).toBe(15)
    expect(config.port).toBe(3120)
    expect(config.repoWhitelist).toEqual(['d:/work/project'])
    expect(secrets.deepseekApiKey).toBe('test-key')
  })

  it('normalizes whitelist entries and resolves the global spec path', () => {
    const { config } = load({ repoWhitelist: ['D:\\Work\\Proj\\', 'E:/Other/Path/'] })
    expect(config.repoWhitelist).toEqual(['d:/work/proj', 'e:/other/path'])
    expect(config.globalSpecPathAbsolute).toBe(join(dir, 'spec.md'))
  })

  it('aggregates multiple problems instead of failing on the first', () => {
    expect(() =>
      load({ port: 99_999 }, {}),
    ).toThrow(ConfigError)
    try {
      load({ port: 99_999 })
    } catch (error) {
      expect((error as ConfigError).problems.length).toBeGreaterThanOrEqual(1)
    }
  })

  it('fails loud on missing config file', () => {
    expectProblems(
      () => loadConfig({ configPath: join(dir, 'absent.yaml'), envPath: join(dir, '.env'), processEnv: {} }),
      'config file not found',
    )
  })

  it('fails loud on invalid YAML', () => {
    writeFileSync(join(dir, 'config.yaml'), 'provider: [unclosed\n')
    expectProblems(
      () => loadConfig({ configPath: join(dir, 'config.yaml'), envPath: join(dir, '.env'), processEnv: {} }),
      'not valid YAML',
    )
  })

  it('rejects out-of-bounds numeric fields', () => {
    expectProblems(() => load({ port: 0 }), 'port')
    expectProblems(() => load({ reviewTimeoutMin: 121 }), 'reviewTimeoutMin')
  })

  it('rejects an empty whitelist', () => {
    expectProblems(() => load({ repoWhitelist: [] }), 'repoWhitelist')
  })

  it('rejects a relative whitelist entry', () => {
    expectProblems(() => load({ repoWhitelist: ['./local'] }), 'absolute path')
  })

  it('fails loud when the global spec file is missing', () => {
    rmSync(join(dir, 'spec.md'))
    expectProblems(() => load(), 'globalSpecPath')
  })

  it('fails loud without DEEPSEEK_API_KEY', () => {
    // Write config only; no .env, no process env key.
    writeFileSync(join(dir, 'config.yaml'), validYaml())
    expectProblems(
      () => loadConfig({ configPath: join(dir, 'config.yaml'), envPath: join(dir, '.env'), processEnv: {} }),
      'DEEPSEEK_API_KEY',
    )
  })

  it('process environment wins over .env values', () => {
    writeFileSync(join(dir, 'config.yaml'), `${validYaml()}\n`)
    writeEnv()
    const { secrets } = loadConfig({
      configPath: join(dir, 'config.yaml'),
      envPath: join(dir, '.env'),
      processEnv: { DEEPSEEK_API_KEY: 'from-process' },
    })
    expect(secrets.deepseekApiKey).toBe('from-process')
  })

  it('carries optional secrets when present', () => {
    const { secrets } = load({}, { DEEPSEEK_BASE_URL: 'https://gw.internal/v1', GIT_ACCESS_TOKEN: 'tok' })
    expect(secrets.deepseekBaseUrl).toBe('https://gw.internal/v1')
    expect(secrets.gitAccessToken).toBe('tok')
  })
})

describe('isPathWhitelisted', () => {
  const whitelist = ['d:/work/project']

  it('accepts the entry itself and subpaths in any slash/case form', () => {
    expect(isPathWhitelisted(whitelist, 'D:/work/project')).toBe(true)
    expect(isPathWhitelisted(whitelist, 'D:\\work\\project\\sub\\repo')).toBe(true)
    expect(isPathWhitelisted(whitelist, 'd:/WORK/PROJECT/Repo')).toBe(true)
  })

  it('rejects prefix-similar siblings, relatives, and outside paths', () => {
    expect(isPathWhitelisted(whitelist, 'D:/work/project-evil')).toBe(false)
    expect(isPathWhitelisted(whitelist, 'D:/work/projectories/x')).toBe(false)
    expect(isPathWhitelisted(whitelist, './work/project')).toBe(false)
    expect(isPathWhitelisted(whitelist, 'E:/work/project')).toBe(false)
  })

  it('is a pure function over the normalized entry list', () => {
    expect(normalizePath('D:\\Work\\Proj\\/')).toBe('d:/work/proj')
  })
})

describe('parseDotenv', () => {
  it('parses values, comments, and quotes', () => {
    const env = parseDotenv(
      [
        '# comment',
        'A=1',
        'B = spaced value ',
        'C="quoted value"',
        "D='single'",
        '',
        'E=',
      ].join('\n'),
    )
    expect(env).toEqual({ A: '1', B: 'spaced value', C: 'quoted value', D: 'single', E: '' })
  })

  it('ignores malformed lines', () => {
    expect(parseDotenv('NO_EQUALS_HERE\n=NOKEY\nGOOD=1')).toEqual({ GOOD: '1' })
  })
})
