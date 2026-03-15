type CharacterCreationJob = {
  id: string
  phase: 'draft' | 'saving' | 'generating' | 'completed' | 'failed'
  message: string
  error?: string
}

type StartResponse = {
  jobId: string
}

const parseArgs = (argv: string[]): { baseUrl: string; timeoutMs: number; pollMs: number } => {
  let baseUrl = 'http://localhost:5173'
  let timeoutMs = 120_000
  let pollMs = 1_500

  argv.forEach((arg) => {
    if (arg.startsWith('--base-url=')) {
      baseUrl = arg.slice('--base-url='.length).trim() || baseUrl
      return
    }
    if (arg.startsWith('--timeout-ms=')) {
      timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10) || timeoutMs
      return
    }
    if (arg.startsWith('--poll-ms=')) {
      pollMs = Number.parseInt(arg.slice('--poll-ms='.length), 10) || pollMs
    }
  })

  return { baseUrl: baseUrl.replace(/\/$/, ''), timeoutMs, pollMs }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const raw = await response.text()
  let parsed: Record<string, unknown> = {}
  try {
    parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${raw.slice(0, 300)}`)
  }
  if (!response.ok) {
    const errorMessage =
      (typeof parsed.error === 'string' && parsed.error) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      `HTTP ${response.status} at ${url}`
    throw new Error(errorMessage)
  }
  return parsed as T
}

const main = async (): Promise<void> => {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = args.baseUrl

  console.log(`[character-smoke] start baseUrl=${baseUrl}`)
  const start = await fetchJson<StartResponse>(`${baseUrl}/api/character-creator/start`, {
    method: 'POST',
    body: JSON.stringify({
      prompt:
        'Smoke-Test Character: freundlich, kindgerecht, klar erkennbare Farben, einfache Kleidung, positive Ausstrahlung.',
      fillMissingFieldsCreatively: true,
      referenceImageIds: [],
    }),
  })

  console.log(`[character-smoke] accepted jobId=${start.jobId}`)
  const startedAt = Date.now()
  while (Date.now() - startedAt < args.timeoutMs) {
    const job = await fetchJson<CharacterCreationJob>(
      `${baseUrl}/api/character-creator/jobs/${encodeURIComponent(start.jobId)}`,
    )
    console.log(`[character-smoke] phase=${job.phase} message=${job.message}`)
    if (job.phase === 'completed') {
      console.log('[character-smoke] SUCCESS')
      return
    }
    if (job.phase === 'failed') {
      throw new Error(job.error || job.message || 'Character-Job failed')
    }
    await sleep(args.pollMs)
  }

  throw new Error(`[character-smoke] timeout after ${args.timeoutMs}ms`)
}

void main()

