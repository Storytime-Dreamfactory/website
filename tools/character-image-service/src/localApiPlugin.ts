import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import OpenAI from 'openai'
import type { AssetGenerationRecord } from './types.ts'
import { createCharacterDraft } from './createCharacterDraft.ts'
import { saveCharacterYaml } from './saveCharacterYaml.ts'
import { generateCharacterImages } from './generateCharacterImages.ts'
import { loadWorldContext } from './loadWorldContext.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

const FALLBACK_STYLE_REFERENCE = path.resolve(
  '/Users/fabianmaximilianjakobi/.cursor/projects/Users-fabianmaximilianjakobi-Development-Storytime-website/assets/38e36ab649947431e52d7164a7ce4824e3db6635-c9d99897-6ed4-4b42-a454-335b58395449.png',
)

type CharacterCreationJob = {
  id: string
  createdAt: string
  updatedAt: string
  phase: 'draft' | 'saving' | 'generating' | 'completed' | 'failed'
  message: string
  prompt?: string
  yamlText?: string
  characterId?: string
  contentPath?: string
  publicPath?: string
  manifestPath?: string
  error?: string
  assets: AssetGenerationRecord[]
}

type MiddlewareStack = {
  use: (
    route: string,
    handler: (
      request: IncomingMessage,
      response: ServerResponse,
      next: (error?: unknown) => void,
    ) => void | Promise<void>,
  ) => void
}

const jobs = new Map<string, CharacterCreationJob>()

type ChatMessage = {
  role: 'assistant' | 'user'
  content: string
}

const json = (response: ServerResponse, statusCode: number, data: unknown): void => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(data))
}

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) {
    return {}
  }

  return JSON.parse(raw) as Record<string, unknown>
}

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const resolveStyleReferencePaths = async (): Promise<string[]> => {
  const configured = process.env.STORYTIME_STYLE_REFERENCE_PATH
  const candidates = [configured, FALLBACK_STYLE_REFERENCE].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )

  const result: string[] = []
  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      result.push(candidate)
    }
  }

  return [...new Set(result)]
}

const buildFallbackChatReply = (messages: ChatMessage[]) => {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter((value) => value.length > 0)
  const compiledPrompt = userMessages.join('\n')
  const isReady = compiledPrompt.length >= 80

  const reply = isReady
    ? 'Perfekt, das reicht mir. Wenn du moechtest, erstelle ich jetzt den Character und die Assets.'
    : 'Cooler Start! Erzaehl mir noch Name, Aussehen, Outfit, Persoenlichkeit und eine kleine Hintergrundidee.'

  return {
    reply,
    isReady,
    compiledPrompt,
  }
}

const getChatAgentReply = async (messages: ChatMessage[]) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return buildFallbackChatReply(messages)
  }

  const client = new OpenAI({ apiKey })
  const systemPrompt = [
    'Du bist der Storytime Character Agent.',
    'Fuehre eine kurze, freundliche Chat-Konversation auf Deutsch, um genug Infos fuer einen neuen Character zu sammeln.',
    'Wichtige Daten: Name, Spezies/Art, visuelle Merkmale, Kleidung/Accessoires, Kern-Persoenlichkeit, Motivation oder Ziel.',
    'Antwort immer als JSON-Objekt mit den Feldern reply (string), isReady (boolean), compiledPrompt (string).',
    'Wenn genug Informationen vorhanden sind, setze isReady=true und fasse alle Character-Details in compiledPrompt kompakt zusammen.',
    'reply soll maximal 2-3 Saetze haben und keine YAML-Ausgabe enthalten.',
  ].join(' ')

  const completion = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.35,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.map((message) => ({ role: message.role, content: message.content })),
    ],
  })

  const raw = completion.choices[0]?.message?.content?.trim()
  if (!raw) {
    throw new Error('Character-Agent hat keine Antwort geliefert.')
  }

  try {
    const parsed = JSON.parse(raw) as {
      reply?: unknown
      isReady?: unknown
      compiledPrompt?: unknown
    }

    if (
      typeof parsed.reply === 'string' &&
      typeof parsed.isReady === 'boolean' &&
      typeof parsed.compiledPrompt === 'string'
    ) {
      return parsed
    }
  } catch {
    // Fallback unterhalb.
  }

  return buildFallbackChatReply(messages)
}

const updateJob = (jobId: string, patch: Partial<CharacterCreationJob>): CharacterCreationJob => {
  const current = jobs.get(jobId)
  if (!current) {
    throw new Error(`Unknown job ${jobId}`)
  }

  const next: CharacterCreationJob = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  }

  jobs.set(jobId, next)
  return next
}

const startGenerationJob = async (jobId: string): Promise<void> => {
  const job = jobs.get(jobId)
  if (!job || !job.yamlText) {
    return
  }

  try {
    updateJob(jobId, {
      phase: 'saving',
      message: 'Speichere Character-YAML und aktualisiere das Manifest...',
    })

    const saved = await saveCharacterYaml(job.yamlText)
    updateJob(jobId, {
      characterId: saved.characterId,
      contentPath: saved.contentPath,
      publicPath: saved.publicPath,
      yamlText: saved.normalizedYamlText,
      phase: 'generating',
      message: 'Bereite die Bildjobs vor...',
    })

    const styleReferencePaths = await resolveStyleReferencePaths()

    const { manifestPath } = await generateCharacterImages({
      characterPath: saved.contentPath,
      outputRoot: path.resolve(workspaceRoot, 'public/content/characters'),
      styleReferencePaths,
      defaultModel: 'flux-2-pro-preview',
      heroModel: 'flux-2-max',
      dryRun: false,
      overwrite: true,
      baseSeed: 4242,
      pollIntervalMs: 1000,
      maxPollAttempts: 120,
      onProgress: (event) => {
        if (event.type === 'planned') {
          updateJob(jobId, {
            phase: 'generating',
            message: 'Bildjobs geplant, starte Generierung...',
            assets: event.assets,
          })
          return
        }

        if (event.type === 'asset-started') {
          const current = jobs.get(jobId)
          if (!current) return

          updateJob(jobId, {
            phase: 'generating',
            message: `Generiere ${event.asset.label}...`,
            assets: current.assets.map((asset) =>
              asset.id === event.asset.id ? { ...asset, status: 'running' } : asset,
            ),
          })
          return
        }

        if (event.type === 'asset-finished') {
          const current = jobs.get(jobId)
          if (!current) return

          updateJob(jobId, {
            phase: 'generating',
            message: `${event.asset.type} abgeschlossen.`,
            assets: current.assets.map((asset) =>
              asset.id === event.asset.id ? event.asset : asset,
            ),
          })
          return
        }

        if (event.type === 'completed') {
          updateJob(jobId, {
            phase: 'completed',
            message: 'Alle Bilder wurden erfolgreich erzeugt.',
            manifestPath: event.manifestPath,
            assets: event.manifest.assets,
          })
          return
        }

        if (event.type === 'failed') {
          updateJob(jobId, {
            phase: 'failed',
            message: event.message,
            error: event.message,
          })
        }
      },
    })

    updateJob(jobId, {
      phase: 'completed',
      message: 'Character und Bilder sind fertig.',
      manifestPath,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updateJob(jobId, {
      phase: 'failed',
      message,
      error: message,
    })
  }
}

const registerCharacterApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/character-creator', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')

      if (request.method === 'POST' && requestUrl.pathname === '/draft') {
        if (!process.env.OPENAI_API_KEY) {
          json(response, 400, {
            error: 'OPENAI_API_KEY fehlt. Bitte setze den OpenAI API Key in der Umgebung.',
          })
          return
        }

        const body = await readJsonBody(request)
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''

        if (!prompt) {
          json(response, 400, { error: 'Bitte gib eine Character-Beschreibung ein.' })
          return
        }

        const worldContext = await loadWorldContext()
        const draft = await createCharacterDraft(prompt, worldContext)
        json(response, 200, draft)
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/chat') {
        const body = await readJsonBody(request)
        const incomingMessages = Array.isArray(body.messages) ? body.messages : []
        const messages: ChatMessage[] = incomingMessages
          .filter(
            (entry): entry is { role: string; content: string } =>
              typeof entry === 'object' &&
              entry !== null &&
              typeof (entry as { role?: unknown }).role === 'string' &&
              typeof (entry as { content?: unknown }).content === 'string',
          )
          .map((entry) => {
            const role: ChatMessage['role'] = entry.role === 'assistant' ? 'assistant' : 'user'
            return {
              role,
              content: entry.content.trim(),
            }
          })
          .filter((entry) => entry.content.length > 0)

        if (messages.length === 0) {
          json(response, 400, { error: 'Bitte sende mindestens eine Chat-Nachricht.' })
          return
        }

        const chatResponse = await getChatAgentReply(messages)
        json(response, 200, chatResponse)
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/start') {
        if (!process.env.BFL_API_KEY) {
          json(response, 400, {
            error: 'BFL_API_KEY fehlt. Bitte setze den FLUX API Key in der Umgebung.',
          })
          return
        }

        const body = await readJsonBody(request)
        const yamlText = typeof body.yamlText === 'string' ? body.yamlText.trim() : ''
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : undefined

        if (!yamlText) {
          json(response, 400, { error: 'Bitte gib ein YAML fuer den Character an.' })
          return
        }

        const jobId = randomUUID()
        const job: CharacterCreationJob = {
          id: jobId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          phase: 'draft',
          message: 'Job angelegt.',
          prompt,
          yamlText,
          assets: [],
        }

        jobs.set(jobId, job)
        void startGenerationJob(jobId)

        json(response, 202, { jobId })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname.startsWith('/jobs/')) {
        const jobId = requestUrl.pathname.split('/').pop()
        const job = jobId ? jobs.get(jobId) : undefined

        if (!job) {
          json(response, 404, { error: 'Job nicht gefunden.' })
          return
        }

        json(response, 200, job)
        return
      }

      next()
    } catch (error) {
      json(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

export const characterCreatorApiPlugin = (): Plugin => ({
  name: 'storytime-character-creator-api',
  configureServer(server) {
    registerCharacterApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerCharacterApi(server.middlewares)
  },
})
