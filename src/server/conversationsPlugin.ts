import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  appendConversationMessage,
  endConversation,
  startConversation,
  type ConversationMetadata,
} from './conversationStore.ts'

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

const toMetadata = (value: unknown): ConversationMetadata | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as ConversationMetadata
}

const registerConversationsApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/conversations', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')

      if (request.method === 'POST' && requestUrl.pathname === '/start') {
        const body = await readJsonBody(request)
        const characterId = typeof body.characterId === 'string' ? body.characterId : ''
        const userId = typeof body.userId === 'string' ? body.userId : undefined
        const metadata = toMetadata(body.metadata)

        const conversation = await startConversation({
          characterId,
          userId,
          metadata,
        })
        json(response, 201, { conversation })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/message') {
        const body = await readJsonBody(request)
        const conversationId =
          typeof body.conversationId === 'string' ? body.conversationId : ''
        const role = typeof body.role === 'string' ? body.role : ''
        const content = typeof body.content === 'string' ? body.content : ''
        const eventType = typeof body.eventType === 'string' ? body.eventType : undefined
        const metadata = toMetadata(body.metadata)

        const message = await appendConversationMessage({
          conversationId,
          role: role as 'user' | 'assistant' | 'system',
          content,
          eventType,
          metadata,
        })

        json(response, 201, { message })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/end') {
        const body = await readJsonBody(request)
        const conversationId =
          typeof body.conversationId === 'string' ? body.conversationId : ''
        const metadata = toMetadata(body.metadata)

        const conversation = await endConversation(conversationId, { metadata })
        json(response, 200, { conversation })
        return
      }

      next()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode =
        message.includes('erforderlich') || message.includes('muss') || message.includes('nicht gefunden')
          ? 400
          : 500
      json(response, statusCode, { error: message })
    }
  })
}

export const conversationsApiPlugin = (): Plugin => ({
  name: 'storytime-conversations-api',
  configureServer(server) {
    registerConversationsApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerConversationsApi(server.middlewares)
  },
})
