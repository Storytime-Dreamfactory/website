type Mode = 'auto' | 'local-full' | 'local-remote-api' | 'production-smoke'

type Args = {
  mode: Mode
  baseUrl: string
  allowedCodes: string
}

const parseArgs = (argv: string[]): Args => {
  let mode: Mode = 'auto'
  let baseUrl = ''
  let allowedCodes = '200'

  let positionalIndex = 0
  argv.forEach((arg) => {
    if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length) as Mode
      return
    }
    if (arg.startsWith('--base-url=')) {
      baseUrl = arg.slice('--base-url='.length).trim()
      return
    }
    if (arg.startsWith('--allowed-codes=')) {
      allowedCodes = arg.slice('--allowed-codes='.length).trim() || '200'
      return
    }
    if (!arg.startsWith('--') && !baseUrl) {
      positionalIndex += 1
      if (positionalIndex === 1) {
        baseUrl = arg.trim()
        return
      }
      if (positionalIndex === 2) {
        allowedCodes = arg.trim() || allowedCodes
      }
    }
  })

  return { mode, baseUrl, allowedCodes }
}

const isTruthy = (value: string | undefined): boolean =>
  ['1', 'true', 'yes', 'on'].includes((value ?? '').trim().toLowerCase())

const resolveMode = (requested: Mode): Exclude<Mode, 'auto'> => {
  if (requested !== 'auto') return requested
  return isTruthy(process.env.STORYTIME_USE_REMOTE_APIS) ? 'local-remote-api' : 'local-full'
}

const readEnv = (name: string): string => process.env[name]?.trim() ?? ''

const printSummary = (mode: Exclude<Mode, 'auto'>): void => {
  console.log(`[preflight] mode=${mode}`)
  console.log(
    `[preflight] STORYTIME_USE_REMOTE_APIS=${readEnv('STORYTIME_USE_REMOTE_APIS') || '(unset)'}`,
  )
}

const fail = (message: string): never => {
  console.error(`[preflight] ${message}`)
  process.exit(1)
}

const ensureRequired = (name: string): void => {
  if (!readEnv(name)) {
    fail(`Missing required env var: ${name}`)
  }
}

const isUsableOpenAiApiKey = (value: string): boolean => {
  if (!value) return false
  if (value.includes('your_openai_api_key_here')) return false
  if (value.includes('your_ope************here')) return false
  return value.startsWith('sk-')
}

const isUsableBflApiKey = (value: string): boolean => {
  if (!value) return false
  if (value.includes('your_bfl_api_key_here')) return false
  return value.startsWith('bfl_')
}

const parseAllowedCodes = (csv: string): Set<number> => {
  const values = csv
    .split(',')
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry))
  return new Set(values)
}

const checkEndpoint = async (url: string, allowedCodes: Set<number>): Promise<void> => {
  const response = await fetch(url, { method: 'GET' })
  if (!allowedCodes.has(response.status)) {
    fail(`Endpoint check failed for ${url} (status=${response.status})`)
  }
}

const runProductionSmokePreflight = async (args: Args): Promise<void> => {
  const baseUrl = args.baseUrl.replace(/\/$/, '')
  if (!baseUrl) {
    fail(
      'production-smoke requires base URL. Example: npm run deploy:smoke -- https://your-domain.vercel.app',
    )
  }
  if (!/^https?:\/\//i.test(baseUrl)) {
    fail(`Invalid base URL: ${baseUrl}`)
  }

  const allowedCodes = parseAllowedCodes(args.allowedCodes || '200')
  if (allowedCodes.size === 0) {
    fail(`Invalid allowed status codes: ${args.allowedCodes}`)
  }

  console.log(`[preflight] Checking ${baseUrl}/health and ${baseUrl}/ready`)
  await checkEndpoint(`${baseUrl}/health`, allowedCodes)
  await checkEndpoint(`${baseUrl}/ready`, allowedCodes)
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const mode = resolveMode(args.mode)
  printSummary(mode)

  if (mode === 'local-full') {
    ensureRequired('OPENAI_API_KEY')
    ensureRequired('BFL_API_KEY')
    ensureRequired('DATABASE_URL')
    if (!isUsableOpenAiApiKey(readEnv('OPENAI_API_KEY'))) {
      fail('OPENAI_API_KEY is set but invalid for local-full mode')
    }
    if (!isUsableBflApiKey(readEnv('BFL_API_KEY'))) {
      fail('BFL_API_KEY is set but invalid for local-full mode')
    }
    console.log('[preflight] local-full requirements satisfied')
    return
  }

  if (mode === 'local-remote-api') {
    ensureRequired('STORYTIME_REMOTE_API_ORIGIN')
    if (!isTruthy(process.env.STORYTIME_USE_REMOTE_APIS)) {
      fail('Set STORYTIME_USE_REMOTE_APIS=true for local-remote-api mode')
    }
    console.log('[preflight] local-remote-api requirements satisfied')
    return
  }

  await runProductionSmokePreflight(args)
  console.log('[preflight] production-smoke requirements satisfied')
}

void main()

