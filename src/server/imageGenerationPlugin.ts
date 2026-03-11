import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { generateImageWithModel } from './imageGenerationService.ts'
import { DEFAULT_IMAGE_MODEL, SUPPORTED_IMAGE_MODELS, type SupportedImageModel } from './imageModelSupport.ts'

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

const DEFAULT_WIDTH = 1024
const DEFAULT_HEIGHT = 1024
const DEFAULT_OUTPUT_FORMAT = 'jpeg'
const DEFAULT_POLL_INTERVAL_MS = 1_000
const DEFAULT_MAX_POLL_ATTEMPTS = 120

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
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

const clampDimension = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const rounded = Math.floor(value)
  return Math.max(256, Math.min(2048, rounded))
}

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  const rounded = Math.floor(value)
  return Math.max(min, Math.min(max, rounded))
}

const supportedModelsHint = SUPPORTED_IMAGE_MODELS.join(', ')

const describeMissingApiKey = (model: SupportedImageModel): string =>
  model.startsWith('flux-')
    ? 'BFL_API_KEY fehlt. Bitte setze den FLUX API Key in der Umgebung.'
    : model.startsWith('gemini-')
      ? 'GOOGLE_GEMINI_API_KEY fehlt. Bitte setze den Google Gemini API Key in der Umgebung.'
      : 'OPENAI_API_KEY fehlt. Bitte setze den OpenAI API Key in der Umgebung.'

const isMissingKeyError = (message: string): boolean =>
  message.includes('BFL_API_KEY fehlt') ||
  message.includes('GOOGLE_GEMINI_API_KEY fehlt') ||
  message.includes('OPENAI_API_KEY fehlt')

const isUnsupportedModelError = (message: string): boolean => message.includes('Unsupported image model')

const normalizeModel = (value: unknown): SupportedImageModel => {
  if (typeof value === 'string' && value.trim().length > 0) {
    const normalized = value.trim()
    if (SUPPORTED_IMAGE_MODELS.includes(normalized as SupportedImageModel)) {
      return normalized as SupportedImageModel
    }
  }

  return DEFAULT_IMAGE_MODEL
}

const parseOutputFormat = (value: unknown): 'png' | 'jpeg' =>
  value === 'png' ? 'png' : DEFAULT_OUTPUT_FORMAT

const parseSeed = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value)
  }
  return Math.floor(Math.random() * 2_147_483_647)
}

const registerImageGenerationApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/images', async (request, response, next) => {
    let requestedModel: SupportedImageModel = DEFAULT_IMAGE_MODEL
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')
      if (request.method !== 'POST' || requestUrl.pathname !== '/generate') {
        next()
        return
      }

      const body = await readJsonBody(request)
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (!prompt) {
        json(response, 400, { error: 'prompt ist erforderlich.' })
        return
      }

      const model = normalizeModel(body.model)
      requestedModel = model
      const width = clampDimension(body.width, DEFAULT_WIDTH)
      const height = clampDimension(body.height, DEFAULT_HEIGHT)
      const outputFormat = parseOutputFormat(body.outputFormat)
      const seed = parseSeed(body.seed)
      const pollIntervalMs = clampInteger(body.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 200, 10_000)
      const maxPollAttempts = clampInteger(body.maxPollAttempts, DEFAULT_MAX_POLL_ATTEMPTS, 10, 600)

      const result = await generateImageWithModel({
        model,
        prompt,
        width,
        height,
        outputFormat,
        seed,
        pollIntervalMs,
        maxPollAttempts,
      })

      json(response, 200, {
        requestId: result.requestId,
        imageUrl: result.imageUrl,
        model,
        prompt,
        width,
        height,
        outputFormat: result.outputFormat,
        seed,
        cost: result.cost,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isMissingKeyError(message)) {
        json(response, 400, { error: describeMissingApiKey(requestedModel) })
        return
      }
      if (isUnsupportedModelError(message)) {
        json(response, 400, {
          error: `Nicht unterstuetztes Bildmodell. Erlaubt: ${supportedModelsHint}`,
        })
        return
      }
      json(response, 500, { error: message })
    }
  })
}

export const imageGenerationApiPlugin = (): Plugin => ({
  name: 'storytime-image-generation-api',
  configureServer(server) {
    registerImageGenerationApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerImageGenerationApi(server.middlewares)
  },
})
