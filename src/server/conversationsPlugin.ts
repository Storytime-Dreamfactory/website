import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  getConversationDetails,
  getCharacterIdsWithConversations,
  getLatestConversationForCharacter,
  subscribeToConversationChanges,
  type ConversationMetadata,
} from './conversationStore.ts'
import { subscribeToActivityChanges, getActivityById } from './activityStore.ts'
import {
  inspectLatestConversation,
  inspectConversation,
} from './debugConversationReadService.ts'
import {
  appendConversationFlowMessage,
  endConversationFlow,
  mergeConversationFlowMetadata,
  startConversationFlow,
  readRuntimeNotepadFromMetadata,
} from './conversationFlowService.ts'

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

      if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '')) {
        const conversationId = requestUrl.searchParams.get('conversationId')?.trim() || ''
        const details = await getConversationDetails(conversationId)
        json(response, 200, details)
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/characters-with-conversations') {
        const characterIds = await getCharacterIdsWithConversations()
        json(response, 200, { characterIds: Array.from(characterIds) })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/latest') {
        const characterId = requestUrl.searchParams.get('characterId')?.trim() || ''
        if (!characterId) {
          json(response, 400, { error: 'characterId query parameter ist erforderlich.' })
          return
        }
        const details = await getLatestConversationForCharacter(characterId)
        if (!details) {
          json(response, 404, { error: 'Keine Conversation fuer diesen Character gefunden.' })
          return
        }
        json(response, 200, details)
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/start') {
        const body = await readJsonBody(request)
        const characterId = typeof body.characterId === 'string' ? body.characterId : ''
        const userId = typeof body.userId === 'string' ? body.userId : undefined
        const metadata = toMetadata(body.metadata)

        const { conversation } = await startConversationFlow({
          characterId,
          userId,
          metadata,
        })
        json(response, 201, { conversation })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/metadata') {
        const body = await readJsonBody(request)
        const conversationId =
          typeof body.conversationId === 'string' ? body.conversationId : ''
        const metadata = toMetadata(body.metadata)

        const { conversation } = await mergeConversationFlowMetadata({
          conversationId,
          metadata,
        })
        json(response, 200, { conversation })
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
        // #region agent log
        fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'N1',location:'conversationsPlugin.ts:/api/conversations/message',message:'Conversation message API empfangen',data:{conversationId,role,eventType,contentPreview:content.slice(0,120)},timestamp:Date.now()})}).catch(()=>{})
        // #endregion

        const { message } = await appendConversationFlowMessage({
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

        const { conversation } = await endConversationFlow({
          conversationId,
          metadata,
        })
        json(response, 200, { conversation })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/latest-inspect') {
        const characterId = requestUrl.searchParams.get('characterId')?.trim() || ''
        if (!characterId) {
          json(response, 400, { error: 'characterId query parameter ist erforderlich.' })
          return
        }
        const result = await inspectLatestConversation(characterId)
        if (!result) {
          json(response, 404, { error: 'Keine Conversation fuer diesen Character gefunden.' })
          return
        }
        json(response, 200, result)
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/stream') {
        const conversationId = requestUrl.searchParams.get('conversationId')?.trim() || ''
        if (!conversationId) {
          json(response, 400, { error: 'conversationId query parameter ist erforderlich.' })
          return
        }

        response.statusCode = 200
        response.setHeader('Content-Type', 'text/event-stream')
        response.setHeader('Cache-Control', 'no-cache, no-transform')
        response.setHeader('Connection', 'keep-alive')
        response.write('retry: 3000\n')

        try {
          const details = await getConversationDetails(conversationId)
          const notepad = readRuntimeNotepadFromMetadata(details.conversation.metadata)
          response.write('event: ready\n')
          response.write(
            `data: ${JSON.stringify({
              status: 'connected',
              conversationId,
              notepad: notepad.text || '',
              notepadUpdatedAt: notepad.updatedAt || null,
            })}\n\n`,
          )
        } catch {
          response.write('event: ready\n')
          response.write(
            `data: ${JSON.stringify({ status: 'connected', conversationId, notepad: '', notepadUpdatedAt: null })}\n\n`,
          )
        }

        const heartbeat = setInterval(() => {
          response.write(': keepalive\n\n')
        }, 25_000)

        const unsubConversation = subscribeToConversationChanges((changeEvent) => {
          if (changeEvent.conversationId !== conversationId) return
          if (changeEvent.event === 'metadata.updated') {
            const notepad = readRuntimeNotepadFromMetadata(changeEvent.metadata)
            response.write('event: notepad.updated\n')
            response.write(
              `data: ${JSON.stringify({
                text: notepad.text || '',
                updatedAt: notepad.updatedAt || null,
              })}\n\n`,
            )
          } else if (changeEvent.event === 'message.created') {
            response.write('event: message.created\n')
            response.write(`data: ${JSON.stringify(changeEvent.message)}\n\n`)
          }
        })

        const unsubActivity = await subscribeToActivityChanges((changeEvent) => {
          void (async () => {
            const activity = await getActivityById(changeEvent.activityId)
            if (!activity) return
            if (activity.conversationId !== conversationId) return
            response.write('event: activity.created\n')
            response.write(`data: ${JSON.stringify(activity)}\n\n`)
          })()
        })

        request.on('close', () => {
          clearInterval(heartbeat)
          unsubConversation()
          unsubActivity()
          response.end()
        })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/inspect') {
        const conversationId = requestUrl.searchParams.get('conversationId')?.trim() || ''
        if (!conversationId) {
          json(response, 400, { error: 'conversationId query parameter ist erforderlich.' })
          return
        }
        const result = await inspectConversation(conversationId)
        if (!result) {
          json(response, 404, { error: 'Conversation nicht gefunden.' })
          return
        }
        json(response, 200, result)
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
