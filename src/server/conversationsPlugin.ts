import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  appendConversationMessage,
  endConversation,
  startConversation,
  type ConversationMetadata,
} from './conversationStore.ts'
import { createActivity } from './activityStore.ts'
import { triggerConversationEndedService } from './conversationLifecycleService.ts'

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

const HARDCODED_COUNTERPART_PERSON = 'Yoko'
const CONVERSATION_LINK_PLACEHOLDER = 'Check here'

const toDisplayName = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return value
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
}

const contextFromMetadata = (
  metadata: ConversationMetadata | undefined,
): { placeId?: string; skillIds?: string[] } => {
  if (!metadata) return {}
  const placeCandidate = metadata.placeId ?? metadata.place_id
  const placeId = typeof placeCandidate === 'string' ? placeCandidate.trim() : ''
  const skillIdsFromArray = toStringArray(metadata.skillIds ?? metadata.skill_ids)
  const singleSkill = typeof metadata.skillId === 'string' ? metadata.skillId.trim() : ''
  const combinedSkills = Array.from(
    new Set(
      [...skillIdsFromArray, ...(singleSkill ? [singleSkill] : [])].filter((item) => item.length > 0),
    ),
  )

  return {
    placeId: placeId || undefined,
    skillIds: combinedSkills.length > 0 ? combinedSkills : undefined,
  }
}

const trackActivitySafely = async (input: {
  activityType: string
  isPublic?: boolean
  characterId?: string
  placeId?: string
  skillIds?: string[]
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
          skillIds: context.skillIds,
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
        const context = contextFromMetadata(message.metadata)
        await trackActivitySafely({
          activityType: 'conversation.message.created',
          isPublic: false,
          placeId: context.placeId,
          skillIds: context.skillIds,
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
        await trackActivitySafely({
          activityType: 'conversation.ended',
          isPublic: false,
          characterId: conversation.characterId,
          placeId: context.placeId,
          skillIds: context.skillIds,
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
          skillIds: context.skillIds,
          conversationId: conversation.conversationId,
          subject: {
            type: 'character',
            id: conversation.characterId,
            text: `${characterDisplayName} chatted with ${HARDCODED_COUNTERPART_PERSON}`,
          },
          object: {
            type: 'person',
            id: HARDCODED_COUNTERPART_PERSON.toLowerCase(),
            name: HARDCODED_COUNTERPART_PERSON,
          },
          metadata: {
            ...conversation.metadata,
            summary: `${characterDisplayName} chatted with ${HARDCODED_COUNTERPART_PERSON}`,
            conversationLinkLabel: CONVERSATION_LINK_PLACEHOLDER,
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
