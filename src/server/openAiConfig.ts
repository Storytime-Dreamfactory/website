import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const ENV_FILE_CANDIDATES = ['.env', '.env.local']

export const RUNTIME_TEMPORARY_UNAVAILABLE_MESSAGE =
  'Ich bin aktuell leider sehr muede und kann nicht helfen. Probiere es ein bisschen spaeter noch einmal.'

let envLoaded = false

const stripOptionalQuotes = (value: string): string => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

const loadEnvFileIfPresent = (filePath: string): void => {
  if (!existsSync(filePath)) return
  const raw = readFileSync(filePath, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = trimmed.slice(0, equalsIndex).trim()
    const value = stripOptionalQuotes(trimmed.slice(equalsIndex + 1))
    if (!key || process.env[key] != null) continue
    process.env[key] = value
  }
}

export const ensureServerEnvLoaded = (): void => {
  if (envLoaded) return
  envLoaded = true
  for (const candidate of ENV_FILE_CANDIDATES) {
    loadEnvFileIfPresent(path.resolve(workspaceRoot, candidate))
  }
}

export const readServerEnv = (name: string, fallback = ''): string => {
  ensureServerEnvLoaded()
  const value = process.env[name]?.trim()
  return value && value.length > 0 ? value : fallback
}

export const getOpenAiApiKey = (): string => readServerEnv('OPENAI_API_KEY', '')
