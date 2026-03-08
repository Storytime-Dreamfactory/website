import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  appendConversationMessage,
  endConversation,
  getConversationDetails,
  startConversation,
  type ConversationMetadata,
} from './conversationStore.ts'
import { createActivity } from './activityStore.ts'
import { triggerConversationEndedService } from './conversationLifecycleService.ts'
import {
  orchestrateCharacterRuntimeTurn,
} from './characterRuntimeOrchestrator.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'

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

const DEFAULT_COUNTERPART_PERSON = 'Kind'
const CONVERSATION_LINK_LABEL = 'Conversation ansehen'

const toDisplayName = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return value
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

const resolveCounterpartName = (metadata: ConversationMetadata | undefined): string => {
  const candidates = [metadata?.counterpartName, metadata?.userName, metadata?.displayName]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return DEFAULT_COUNTERPART_PERSON
}

const trackActivitySafely = async (input: {
  activityType: string
  isPublic?: boolean
  characterId?: string
  placeId?: string
  learningGoalIds?: string[]
  conversationId?: string
  subject?: Record<string, unknown>
  object?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): Promise<void> => {
  try {
    await createActivity(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Activity tracking failed: ${message}`)
  }
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
        const context = contextFromMetadata(conversation.metadata)
        await trackActivitySafely({
          activityType: 'conversation.started',
          isPublic: false,
          characterId: conversation.characterId,
          placeId: context.placeId,
          learningGoalIds: context.learningGoalIds,
          conversationId: conversation.conversationId,
          subject: {
            type: 'conversation',
            id: conversation.conversationId,
          },
          object: {
            type: 'character',
            id: conversation.characterId,
          },
          metadata: conversation.metadata,
        })
        if (context.learningGoalIds && context.learningGoalIds.length > 0) {
          await trackActivitySafely({
            activityType: 'conversation.learning_goal.activated',
            isPublic: false,
            characterId: conversation.characterId,
            placeId: context.placeId,
            learningGoalIds: context.learningGoalIds,
            conversationId: conversation.conversationId,
            subject: {
              type: 'conversation',
              id: conversation.conversationId,
            },
            object: {
              type: 'learning_goals',
              ids: context.learningGoalIds,
            },
            metadata: {
              ...conversation.metadata,
              summary: `Lernziel aktiviert: ${context.learningGoalIds.join(', ')}`,
            },
          })
        }
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
        // #region agent log
        fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'N1',location:'conversationsPlugin.ts:/api/conversations/message',message:'Conversation message API empfangen',data:{conversationId,role,eventType,contentPreview:content.slice(0,120)},timestamp:Date.now()})}).catch(()=>{})
        // #endregion

        const message = await appendConversationMessage({
          conversationId,
          role: role as 'user' | 'assistant' | 'system',
          content,
          eventType,
          metadata,
        })
        const context = contextFromMetadata(message.metadata)
        await trackActivitySafely({
          activityType: 'conversation.message.created',
          isPublic: false,
          placeId: context.placeId,
          learningGoalIds: context.learningGoalIds,
          conversationId: message.conversationId,
          subject: {
            type: 'conversation',
            id: message.conversationId,
          },
          object: {
            type: 'message',
            id: String(message.messageId),
            role: message.role,
            eventType: message.eventType,
          },
          metadata: message.metadata,
        })

        if (role === 'user' || role === 'assistant') {
          void orchestrateCharacterRuntimeTurn({
            conversationId,
            role: role as 'user' | 'assistant',
            content,
            eventType,
          }).catch((error) => {
            const reason = error instanceof Error ? error.message : String(error)
            console.warn(`Character runtime orchestration failed: ${reason}`)
          })
        }

        json(response, 201, { message })
        return
      }

      if (request.method === 'POST' && requestUrl.pathname === '/end') {
        const body = await readJsonBody(request)
        const conversationId =
          typeof body.conversationId === 'string' ? body.conversationId : ''
        const metadata = toMetadata(body.metadata)

        const conversation = await endConversation(conversationId, { metadata })
        const context = contextFromMetadata(conversation.metadata)
        const characterDisplayName = toDisplayName(conversation.characterId)
        const counterpartName = resolveCounterpartName(conversation.metadata)
        const publicSummary = `${characterDisplayName} sprach mit ${counterpartName}`
        await trackActivitySafely({
          activityType: 'conversation.ended',
          isPublic: false,
          characterId: conversation.characterId,
          placeId: context.placeId,
          learningGoalIds: context.learningGoalIds,
          conversationId: conversation.conversationId,
          subject: {
            type: 'conversation',
            id: conversation.conversationId,
          },
          object: {
            type: 'character',
            id: conversation.characterId,
          },
          metadata: conversation.metadata,
        })
        await trackActivitySafely({
          activityType: 'character.chat.completed',
          isPublic: true,
          characterId: conversation.characterId,
          placeId: context.placeId,
          learningGoalIds: context.learningGoalIds,
          conversationId: conversation.conversationId,
          subject: {
            type: 'character',
            id: conversation.characterId,
            text: publicSummary,
          },
          object: {
            type: 'person',
            id: counterpartName.toLowerCase(),
            name: counterpartName,
          },
          metadata: {
            ...conversation.metadata,
            summary: publicSummary,
            conversationLinkLabel: CONVERSATION_LINK_LABEL,
          },
        })
        await triggerConversationEndedService(conversation)
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
