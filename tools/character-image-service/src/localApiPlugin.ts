import { access, mkdir, rm, writeFile } from 'node:fs/promises'
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
import { imageBufferToDataUrl, readImageAsDataUrl } from './imageDataUrl.ts'
import { invalidateCache as invalidateGameObjectCache } from '../../../src/server/gameObjectService.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

const CORE_BACKGROUND_STYLE_REFERENCE = path.resolve(
  workspaceRoot,
  'public/generated/storytime-backgrounds/storytime-background-twilight-forest-close-4x3-hd.jpg',
)
const TEMP_REFERENCE_DIRECTORY = path.resolve(workspaceRoot, '.tmp/character-creator')
const CHARACTER_CREATION_DEFAULT_MODEL = 'flux-2-pro'
const CHARACTER_CREATION_HERO_MODEL = 'flux-2-pro'
const CHARACTER_CREATOR_DEFAULT_POLL_INTERVAL_MS = 1000
const CHARACTER_CREATOR_DEFAULT_MAX_POLL_ATTEMPTS = 300

const isUsableOpenAiApiKey = (value: string | undefined): boolean => {
  const key = value?.trim()
  if (!key) return false
  if (key.includes('your_openai_api_key_here')) return false
  if (key.includes('your_ope************here')) return false
  return key.startsWith('sk-')
}

const toUserSafeOpenAiError = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error)
  if (
    raw.includes('Incorrect API key provided') ||
    raw.includes('invalid_api_key') ||
    raw.includes('401')
  ) {
    return 'OPENAI_API_KEY ist ungueltig. Bitte setze einen gueltigen OpenAI API Key in der Umgebung.'
  }
  return raw
}

type UploadedReferenceImage = {
  id: string
  fileName: string
  mimeType: string
  tempFilePath: string
  summary: string
}

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
  /** @deprecated removed – YAML is only written to content/ now */
  publicPath?: string
  manifestPath?: string
  error?: string
  fillMissingFieldsCreatively?: boolean
  referenceImages: UploadedReferenceImage[]
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
const referenceImages = new Map<string, UploadedReferenceImage>()

type ChatMessage = {
  role: 'assistant' | 'user'
  content: string
}

const json = (response: ServerResponse, statusCode: number, data: unknown): void => {
  let payload = data
  if (
    data &&
    typeof data === 'object' &&
    'error' in data &&
    typeof (data as { error?: unknown }).error === 'string' &&
    (!('message' in data) || typeof (data as { message?: unknown }).message !== 'string')
  ) {
    payload = {
      ...(data as Record<string, unknown>),
      message: (data as { error: string }).error,
    }
  }
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(payload))
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

const safeFileName = (value: string): string => {
  const trimmed = value.trim() || 'reference-image.png'
  return path.basename(trimmed).replace(/[^a-zA-Z0-9._-]+/g, '-')
}

const extensionForMimeType = (mimeType: string): string => {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.png'
}

const parseDataUrl = (dataUrl: string): { mimeType: string; buffer: Buffer } => {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    throw new Error('Ungueltiges Bildformat. Bitte lade eine PNG-, JPG-, WEBP- oder GIF-Datei hoch.')
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  }
}

const cleanupReferenceImages = async (images: UploadedReferenceImage[]): Promise<void> => {
  await Promise.all(
    images.map(async (image) => {
      referenceImages.delete(image.id)
      await rm(image.tempFilePath, { force: true })
    }),
  )
}

const resolveStyleReferencePaths = async (): Promise<string[]> => {
  const configured = process.env.STORYTIME_STYLE_REFERENCE_PATH
  const candidates = [configured, CORE_BACKGROUND_STYLE_REFERENCE].filter(
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

const readIntegerEnv = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  const integer = Math.floor(parsed)
  if (integer < min) return min
  if (integer > max) return max
  return integer
}

const describeReferenceImageForCharacterCreation = async (
  filePath: string,
  fileName: string,
): Promise<{ summary: string; merlinReply: string }> => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!isUsableOpenAiApiKey(apiKey)) {
    return {
      summary: `Visuelle Referenz aus ${fileName}: Dieses Bild ist die verbindliche Hauptvorlage fuer Gesicht, Farben, Kleidung und auffaellige Merkmale. Keine Abstraktion, keine Umdeutung, keine Identitaetsaenderung.`,
      merlinReply:
        'Ich habe dein Bild gespeichert und nutze es als Aussehens-Vorlage. Magst du mir jetzt noch sagen, wie dein Character heisst und wie er so ist? Zum Beispiel: mutig, vorsichtig oder lustig.',
    }
  }

  const client = new OpenAI({ apiKey })
  const dataUrl = await readImageAsDataUrl(filePath)
  const completion = await client.chat.completions.create({
    model: 'gpt-5.4',
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: [
          'Du bist Merlin in Storytime.',
          'Du analysierst ein Referenzbild fuer die Character-Erstellung.',
          'Antworte nur als JSON mit den Feldern summary und merlinReply.',
          'summary soll 2 bis 4 Saetze lang sein und nur kindgerechte sichtbare Merkmale beschreiben: Art/Spezies, Farben, Kleidung, Augen, auffaellige Merkmale, Grundstimmung.',
          'Beschreibe nur direkt sichtbare Merkmale, keine erfundenen Details. Wenn etwas unklar ist, lasse es weg statt zu raten.',
          'Formuliere die summary als klare Identitaetsanker fuer spaetere Prompts. Kein Stiltransfer, keine Verallgemeinerung, keine Umbenennung.',
          'merlinReply soll 1 bis 2 kurze deutsche Saetze fuer ein etwa 6-jaehriges Kind enthalten.',
          'Keine Warntexte, keine Markdown-Formatierung, keine technischen Details.',
        ].join(' '),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Beschreibe das Bild als freundliche Character-Referenz fuer Storytime und frage danach auf kindgerechte Weise nach Name und Charaktereigenschaften.',
          },
          {
            type: 'image_url',
            image_url: { url: dataUrl },
          },
        ] as never,
      },
    ],
  })

  const raw = completion.choices[0]?.message?.content?.trim()
  if (!raw) {
    throw new Error('Die Bildanalyse hat keine Antwort geliefert.')
  }

  try {
    const parsed = JSON.parse(raw) as { summary?: unknown; merlinReply?: unknown }
    if (typeof parsed.summary === 'string' && typeof parsed.merlinReply === 'string') {
      return {
        summary: parsed.summary,
        merlinReply: parsed.merlinReply,
      }
    }
  } catch {
    // Fallback below.
  }

  return {
    summary: `Visuelle Referenz aus ${fileName}: Dieses Bild ist die verbindliche Hauptvorlage fuer Gesicht, Farben, Kleidung und auffaellige Merkmale. Keine Abstraktion, keine Umdeutung, keine Identitaetsaenderung.`,
    merlinReply:
      'Ich habe dein Bild als Vorlage verstanden. Erzaehl mir jetzt noch: Wie heisst dein Character und was macht ihn besonders?',
  }
}

const buildFallbackChatReply = (messages: ChatMessage[]) => {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter((value) => value.length > 0)
  const compiledPrompt = userMessages.join('\n')
  const isReady = compiledPrompt.length >= 80

  const reply = isReady
    ? 'Wunderbar, ich habe schon genug fuer deinen Character. Wenn du magst, drueck jetzt auf Erstellen oder auf Skip and create.'
    : 'Ich bin Merlin. Erzaehl mir noch etwas mehr ueber deinen Character. Zum Beispiel: Wie sieht er aus? Wovor hat er Angst? Oder wie wuerde er sich selbst beschreiben?'

  return {
    reply,
    isReady,
    compiledPrompt,
  }
}

const getChatAgentReply = async (messages: ChatMessage[]) => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!isUsableOpenAiApiKey(apiKey)) {
    return buildFallbackChatReply(messages)
  }

  const client = new OpenAI({ apiKey })
  const systemPrompt = [
    'Du bist Merlin, der zentrale freundliche Assistent von Storytime.',
    'Fuehre eine warme, sehr einfache Chat-Konversation auf Deutsch fuer ein etwa 6-jaehriges Kind.',
    'Stelle pro Antwort nur eine kleine Hauptfrage und gib immer 1 oder 2 kurze Beispiele.',
    'Wichtige Character-Daten: Name, Spezies/Art, sichtbare Merkmale, Kleidung/Accessoires, core traits, Angst, Selbstbild/Selbstzweifel, Wunsch oder Ziel.',
    'Wenn das Kind einen Namen nennt, uebernimm ihn exakt in gleicher Schreibweise. Niemals umbenennen, nie uebersetzen, keine Alternativnamen vorschlagen.',
    'Wenn Bildreferenzen genannt wurden, behandle sie als verbindliche Identitaetsanker fuer Aussehen und zentrale Merkmale.',
    'Wenn schon genug Informationen da sind, bestaetige das freundlich und erlaube Erstellen oder Skip and create.',
    'Antwort immer als JSON-Objekt mit den Feldern reply (string), isReady (boolean), compiledPrompt (string).',
    'compiledPrompt soll eine strukturierte Zusammenfassung als kurze Character-Notizen sein und bekannte Felder explizit benennen.',
    'compiledPrompt soll, falls vorhanden, mit diesen Zeilen beginnen: "NAME_EXAKT: ...", "SPEZIES_EXAKT: ...", "IDENTITAETSANKER: ...".',
    'In IDENTITAETSANKER konkrete, sichtbare Merkmale sammeln (Gesichtsform, Augen, Farben, Kleidung, Accessoires, distinctive features).',
    'Wenn ein Bild bereits als Referenz im Chat genannt wurde, uebernimm diese sichtbaren Hinweise in compiledPrompt.',
    'reply soll maximal 3 kurze Saetze haben und keine YAML-Ausgabe enthalten.',
  ].join(' ')

  const completion = await client.chat.completions.create({
    model: 'gpt-5.4',
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
  if (!job) {
    return
  }

  try {
    let yamlText = job.yamlText
    if (!yamlText) {
      updateJob(jobId, {
        phase: 'draft',
        message: 'Merlin baut jetzt den Character-Entwurf...',
      })

      const worldContext = await loadWorldContext()
      const appearanceReferenceSummary = job.referenceImages
        .map((image) => `Visuelle Referenz ${image.fileName}: ${image.summary}`)
        .join('\n')
      const draft = await createCharacterDraft(job.prompt ?? '', worldContext, {
        fillMissingFieldsCreatively: job.fillMissingFieldsCreatively,
        appearanceReferenceSummary,
      })
      yamlText = draft.yamlText

      updateJob(jobId, {
        yamlText,
        characterId: draft.characterId,
        message: 'Merlin hat den Character-Entwurf fertig.',
      })
    }

    updateJob(jobId, {
      phase: 'saving',
      message: 'Speichere Character-YAML und aktualisiere das Manifest...',
    })

    const saved = await saveCharacterYaml(yamlText)
    invalidateGameObjectCache()
    updateJob(jobId, {
      characterId: saved.characterId,
      contentPath: saved.contentPath,
      yamlText: saved.normalizedYamlText,
      phase: 'generating',
      message: 'Bereite die Bildjobs vor...',
    })

    const styleReferencePaths = await resolveStyleReferencePaths()
    const pollIntervalMs = readIntegerEnv(
      'CHARACTER_CREATOR_POLL_INTERVAL_MS',
      CHARACTER_CREATOR_DEFAULT_POLL_INTERVAL_MS,
      200,
      10_000,
    )
    const maxPollAttempts = readIntegerEnv(
      'CHARACTER_CREATOR_MAX_POLL_ATTEMPTS',
      CHARACTER_CREATOR_DEFAULT_MAX_POLL_ATTEMPTS,
      10,
      1_000,
    )

    const { manifestPath } = await generateCharacterImages({
      characterPath: saved.contentPath,
      outputRoot: path.resolve(workspaceRoot, 'public/content/characters'),
      styleReferencePaths,
      // Image-first: user uploads are the only identity source.
      // Style references stay separate and should not override identity.
      characterReferencePaths: job.referenceImages.map((image) => image.tempFilePath),
      defaultModel: CHARACTER_CREATION_DEFAULT_MODEL,
      heroModel: CHARACTER_CREATION_HERO_MODEL,
      dryRun: false,
      overwrite: true,
      baseSeed: 4242,
      pollIntervalMs,
      maxPollAttempts,
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
            phase: 'generating',
            message: event.message,
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
    const message = toUserSafeOpenAiError(error)
    updateJob(jobId, {
      phase: 'failed',
      message,
      error: message,
    })
  } finally {
    await cleanupReferenceImages(job.referenceImages)
  }
}

const registerCharacterApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/character-creator', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')

      if (request.method === 'POST' && requestUrl.pathname === '/draft') {
        if (!isUsableOpenAiApiKey(process.env.OPENAI_API_KEY)) {
          json(response, 400, {
            error:
              'OPENAI_API_KEY fehlt oder ist ungueltig. Bitte setze einen gueltigen OpenAI API Key in der Umgebung.',
          })
          return
        }

        const body = await readJsonBody(request)
        const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
        const fillMissingFieldsCreatively = body.fillMissingFieldsCreatively === true
        const referenceImageIds = Array.isArray(body.referenceImageIds)
          ? body.referenceImageIds.filter((entry): entry is string => typeof entry === 'string')
          : []

        if (!prompt && !fillMissingFieldsCreatively && referenceImageIds.length === 0) {
          json(response, 400, { error: 'Bitte gib eine Character-Beschreibung ein.' })
          return
        }

        const worldContext = await loadWorldContext()
        const appearanceReferenceSummary = referenceImageIds
          .map((id) => referenceImages.get(id))
          .filter((image): image is UploadedReferenceImage => Boolean(image))
          .map((image) => `Visuelle Referenz ${image.fileName}: ${image.summary}`)
          .join('\n')
        const draft = await createCharacterDraft(prompt, worldContext, {
          fillMissingFieldsCreatively,
          appearanceReferenceSummary,
        })
        json(response, 200, draft)
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/reference-image') {
        const body = await readJsonBody(request)
        const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl.trim() : ''
        const incomingFileName = typeof body.fileName === 'string' ? body.fileName : 'reference-image.png'

        if (!dataUrl) {
          json(response, 400, { error: 'Bitte sende ein Bild zum Hochladen.' })
          return
        }

        const { mimeType, buffer } = parseDataUrl(dataUrl)
        if (!mimeType.startsWith('image/')) {
          json(response, 400, { error: 'Bitte lade eine Bilddatei hoch.' })
          return
        }
        if (buffer.byteLength > 10 * 1024 * 1024) {
          json(response, 400, { error: 'Das Bild ist zu gross. Bitte waehle eine Datei unter 10 MB.' })
          return
        }

        await mkdir(TEMP_REFERENCE_DIRECTORY, { recursive: true })
        const referenceId = randomUUID()
        const safeName = safeFileName(incomingFileName)
        const tempFilePath = path.resolve(
          TEMP_REFERENCE_DIRECTORY,
          `${referenceId}${path.extname(safeName) || extensionForMimeType(mimeType)}`,
        )
        await writeFile(tempFilePath, buffer)

        const analysis = await describeReferenceImageForCharacterCreation(tempFilePath, safeName)
        const referenceImage: UploadedReferenceImage = {
          id: referenceId,
          fileName: safeName,
          mimeType,
          tempFilePath,
          summary: analysis.summary,
        }
        referenceImages.set(referenceId, referenceImage)

        json(response, 200, {
          referenceImage: {
            id: referenceImage.id,
            fileName: referenceImage.fileName,
            mimeType: referenceImage.mimeType,
            previewDataUrl: imageBufferToDataUrl(buffer, mimeType),
            summary: referenceImage.summary,
          },
          reply: analysis.merlinReply,
        })
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
        const fillMissingFieldsCreatively = body.fillMissingFieldsCreatively === true
        const referenceImageIds = Array.isArray(body.referenceImageIds)
          ? body.referenceImageIds.filter((entry): entry is string => typeof entry === 'string')
          : []
        const selectedReferenceImages = referenceImageIds
          .map((id) => referenceImages.get(id))
          .filter((image): image is UploadedReferenceImage => Boolean(image))

        if (!yamlText && !prompt && !fillMissingFieldsCreatively && selectedReferenceImages.length === 0) {
          json(response, 400, {
            error: 'Bitte gib YAML, eine Character-Beschreibung oder nutze Skip and create.',
          })
          return
        }
        if (!yamlText && !isUsableOpenAiApiKey(process.env.OPENAI_API_KEY)) {
          json(response, 400, {
            error:
              'OPENAI_API_KEY fehlt oder ist ungueltig. Fuer Character-Draft ohne YAML wird ein gueltiger OpenAI API Key benoetigt.',
          })
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
          yamlText: yamlText || undefined,
          fillMissingFieldsCreatively,
          referenceImages: selectedReferenceImages,
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
        error: toUserSafeOpenAiError(error),
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
