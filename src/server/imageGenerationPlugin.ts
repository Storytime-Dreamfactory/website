import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { FluxClient } from '../../tools/character-image-service/src/fluxClient.ts'
import type { FluxModel } from '../../tools/character-image-service/src/types.ts'

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

const SUPPORTED_MODELS: FluxModel[] = [
  'flux-2-flex',
  'flux-2-pro-preview',
  'flux-2-pro',
  'flux-2-max',
  'flux-2-klein-4b',
  'flux-2-klein-9b',
]

const DEFAULT_MODEL: FluxModel = 'flux-2-flex'
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

const parseModel = (value: unknown): FluxModel => {
  if (typeof value === 'string' && SUPPORTED_MODELS.includes(value as FluxModel)) {
    return value as FluxModel
  }
  return DEFAULT_MODEL
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
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')
      if (request.method !== 'POST' || requestUrl.pathname !== '/generate') {
        next()
        return
      }

      const apiKey = process.env.BFL_API_KEY?.trim()
      if (!apiKey) {
        json(response, 400, {
          error: 'BFL_API_KEY fehlt. Bitte setze den FLUX API Key in der Umgebung.',
        })
        return
      }

      const body = await readJsonBody(request)
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (!prompt) {
        json(response, 400, { error: 'prompt ist erforderlich.' })
        return
      }

      const model = parseModel(body.model)
      const width = clampDimension(body.width, DEFAULT_WIDTH)
      const height = clampDimension(body.height, DEFAULT_HEIGHT)
      const outputFormat = parseOutputFormat(body.outputFormat)
      const seed = parseSeed(body.seed)
      const pollIntervalMs = clampInteger(body.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 200, 10_000)
      const maxPollAttempts = clampInteger(body.maxPollAttempts, DEFAULT_MAX_POLL_ATTEMPTS, 10, 600)

      const client = new FluxClient(apiKey)
      const requestResult = await client.generateTextToImage({
        model,
        prompt,
        width,
        height,
        outputFormat,
        seed,
      })

      const pollResult = await client.pollResult({
        pollingUrl: requestResult.polling_url,
        pollIntervalMs,
        maxAttempts: maxPollAttempts,
      })

      if (pollResult.status !== 'Ready') {
        const errorMessage = 'error' in pollResult ? pollResult.error : undefined
        json(response, 502, {
          error: errorMessage ?? 'FLUX konnte kein Bild erzeugen.',
          status: pollResult.status,
        })
        return
      }

      json(response, 200, {
        requestId: requestResult.id,
        imageUrl: pollResult.result.sample,
        model,
        prompt,
        width,
        height,
        outputFormat,
        seed,
        cost: requestResult.cost,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
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
