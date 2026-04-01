import { Pool } from 'pg'
import { readServerEnv } from './openAiConfig.ts'

const POSTGRES_DEFAULT_URL = 'postgres://storytime:storytime@localhost:5433/storytime'
const DEFAULT_POOL_MAX = 8
const DEFAULT_IDLE_TIMEOUT_MS = 10_000
const DEFAULT_CONNECTION_TIMEOUT_MS = 5_000

const GLOBAL_POOL_KEY = '__storytimeSharedDbPool__'
const GLOBAL_POOL_SIGNATURE_KEY = '__storytimeSharedDbPoolSignature__'

type GlobalWithStorytimePool = typeof globalThis & {
  [GLOBAL_POOL_KEY]?: Pool
  [GLOBAL_POOL_SIGNATURE_KEY]?: string
}

let sharedPool: Pool | null = (globalThis as GlobalWithStorytimePool)[GLOBAL_POOL_KEY] ?? null
let sharedPoolSignature: string | null =
  (globalThis as GlobalWithStorytimePool)[GLOBAL_POOL_SIGNATURE_KEY] ?? null

const readIntegerEnv = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

const resolveSslOption = (
  connectionString: string,
): false | { rejectUnauthorized: boolean } => {
  const explicitSslMode = process.env.DB_SSL_MODE?.trim().toLowerCase()
  if (explicitSslMode === 'require') {
    return { rejectUnauthorized: false }
  }
  if (explicitSslMode === 'disable') {
    return false
  }

  // Ignore PGSSLMODE side-effects from unrelated tooling by controlling SSL explicitly here.
  return /(?:\?|&)sslmode=require(?:&|$)/i.test(connectionString)
    ? { rejectUnauthorized: false }
    : false
}

export const getStorytimeDbPool = (): Pool => {
  const connectionString = readServerEnv('DATABASE_URL', POSTGRES_DEFAULT_URL)
  const max = Math.max(1, readIntegerEnv(readServerEnv('DB_POOL_MAX', String(DEFAULT_POOL_MAX)), DEFAULT_POOL_MAX))
  const idleTimeoutMillis = Math.max(
    1_000,
    readIntegerEnv(
      readServerEnv('DB_POOL_IDLE_TIMEOUT_MS', String(DEFAULT_IDLE_TIMEOUT_MS)),
      DEFAULT_IDLE_TIMEOUT_MS,
    ),
  )
  const connectionTimeoutMillis = Math.max(
    1_000,
    readIntegerEnv(
      readServerEnv('DB_POOL_CONNECTION_TIMEOUT_MS', String(DEFAULT_CONNECTION_TIMEOUT_MS)),
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
  )
  const ssl = resolveSslOption(connectionString)
  const desiredSignature = JSON.stringify({
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ssl,
  })

  if (sharedPool && sharedPoolSignature === desiredSignature) {
    return sharedPool
  }

  if (sharedPool && sharedPoolSignature !== desiredSignature) {
    void sharedPool.end().catch(() => undefined)
    sharedPool = null
  }

  sharedPool = new Pool({
    connectionString,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ssl,
  })
  sharedPoolSignature = desiredSignature
  ;(globalThis as GlobalWithStorytimePool)[GLOBAL_POOL_KEY] = sharedPool
  ;(globalThis as GlobalWithStorytimePool)[GLOBAL_POOL_SIGNATURE_KEY] = sharedPoolSignature

  return sharedPool
}
