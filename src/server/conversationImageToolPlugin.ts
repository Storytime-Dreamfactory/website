import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { generateConversationHeroToolApi } from './runtime/tools/toolApiService.ts'
import { ConversationImageToolApiError } from './conversationImageToolService.ts'

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

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const registerConversationImageToolApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/tools', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')
      if (request.method !== 'POST' || requestUrl.pathname !== '/generate-conversation-hero') {
        next()
        return
      }

      const body = await readJsonBody(request)
      const result = await generateConversationHeroToolApi({
        conversationId: readText(body.conversationId),
        characterId: readText(body.characterId),
        scenePrompt: readText(body.scenePrompt),
        styleHint: readText(body.styleHint),
        interactionTargets: body.interactionTargets,
        relatedCharacterIds: body.relatedCharacterIds,
        relatedCharacterNames: body.relatedCharacterNames,
        forceReferenceImagePaths: body.forceReferenceImagePaths,
        width: body.width,
        height: body.height,
        pollIntervalMs: body.pollIntervalMs,
        maxPollAttempts: body.maxPollAttempts,
        seed: body.seed,
      })
      json(response, 200, result)
    } catch (error) {
      if (error instanceof ConversationImageToolApiError) {
        json(response, error.statusCode, { error: error.message })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      json(response, 500, { error: message })
    }
  })
}

export const conversationImageToolApiPlugin = (): Plugin => ({
  name: 'storytime-conversation-image-tool-api',
  configureServer(server) {
    registerConversationImageToolApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerConversationImageToolApi(server.middlewares)
  },
})
