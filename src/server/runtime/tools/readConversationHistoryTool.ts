import { listActivities } from '../../activityStore.ts'
import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import { getConversationDetails } from '../../conversationStore.ts'
import { trackTraceActivitySafely } from '../../traceActivity.ts'
import {
  readCanonicalStoryText,
  readImagePromptValue,
  readSceneSummaryValue,
} from '../../../storyText.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { trackRuntimeToolActivitySafely } from './runtimeToolActivityLogger.ts'

type ReadConversationHistoryInput = {
  conversationIds?: string[]
  scope?: 'external' | 'all'
  limit?: number
  offset?: number
  fetchAll?: boolean
}

type ReadConversationHistoryOutput = {
  scope: 'external' | 'all'
  limit: number
  offset: number
  conversations: Array<{
    conversationId: string
    characterId: string
    startedAt: string
    endedAt?: string
    messageCount: number
    hasMore: boolean
    nextOffset: number
    messages: Array<{
      messageId: number
      role: 'user' | 'assistant' | 'system'
      eventType?: string
      createdAt: string
      content: string
      imageRefs: {
        imageId?: string
        heroImageUrl?: string
        imageUrl?: string
        imageLinkUrl?: string
        imageAssetPath?: string
        originalImageUrl?: string
      }
      objectRefs: Array<{ objectType?: string; objectId?: string; label?: string }>
      metadata: Record<string, unknown>
    }>
    imageCandidates: Array<{
      messageId: number
      imageId?: string
      imageUrl?: string
      summary?: string
      imagePrompt?: string
      source: 'message-metadata'
    }>
  }>
}

const DEFAULT_LIMIT = 200
const TECHNICAL_EVENT_PREFIXES = ['trace.', 'tool.', 'runtime.', 'skill.']

const clampLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(500, Math.floor(value)))
}

const clampOffset = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

const shouldFetchAll = (value: unknown): boolean => value === true

const readText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const toScope = (value: ReadConversationHistoryInput['scope']): 'external' | 'all' =>
  value === 'all' ? 'all' : 'external'

const isTechnicalEventType = (eventType?: string): boolean => {
  const normalized = eventType?.trim() ?? ''
  if (!normalized) return false
  return TECHNICAL_EVENT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

const isExternalMessage = (message: {
  role: 'user' | 'assistant' | 'system'
  eventType?: string
}): boolean => {
  if (message.role === 'system') return false
  if (isTechnicalEventType(message.eventType)) return false
  return true
}

const extractImageId = (input: {
  imageAssetPath?: string
  imageUrl?: string
  heroImageUrl?: string
  imageLinkUrl?: string
}): string | undefined => {
  const fromAssetPath = readText(input.imageAssetPath)
  if (fromAssetPath) {
    const last = fromAssetPath.split('/').filter(Boolean).at(-1)
    return last?.replace(/\.[a-z0-9]+$/i, '') || undefined
  }
  const fromUrl = readText(input.imageUrl) ?? readText(input.heroImageUrl) ?? readText(input.imageLinkUrl)
  if (!fromUrl) return undefined
  const noQuery = fromUrl.split('?')[0]
  const last = noQuery.split('/').filter(Boolean).at(-1)
  return last?.replace(/\.[a-z0-9]+$/i, '') || undefined
}

export const readConversationHistoryTool: RuntimeToolHandler<
  ReadConversationHistoryInput,
  ReadConversationHistoryOutput
> = {
  id: CHARACTER_AGENT_TOOLS.readConversationHistory,
  execute: async (context, input) => {
    await trackTraceActivitySafely({
      activityType: 'trace.tool.read_conversation_history.request',
      summary: `${context.characterName} startet read_conversation_history`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'request',
      traceSource: 'runtime',
      input,
    })

    const scope = toScope(input.scope)
    const limit = clampLimit(input.limit)
    const offset = clampOffset(input.offset)
    const fetchAll = shouldFetchAll(input.fetchAll)
    const requestedConversationIds = Array.isArray(input.conversationIds)
      ? input.conversationIds
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0)
      : []
    const conversationIds =
      requestedConversationIds.length > 0
        ? Array.from(new Set(requestedConversationIds))
        : Array.from(
            new Set(
              (
                fetchAll
                  ? await (async () => {
                      const allItems: Awaited<ReturnType<typeof listActivities>> = []
                      let pageOffset = 0
                      while (true) {
                        const page = await listActivities({
                          characterId: context.characterId,
                          isPublic: scope === 'external' ? true : undefined,
                          limit: DEFAULT_LIMIT,
                          offset: pageOffset,
                        })
                        allItems.push(...page)
                        if (page.length < DEFAULT_LIMIT) break
                        pageOffset += page.length
                      }
                      return allItems
                    })()
                  : await listActivities({
                      characterId: context.characterId,
                      isPublic: scope === 'external' ? true : undefined,
                      limit: DEFAULT_LIMIT,
                      offset: 0,
                    })
              )
                .map((item) => item.conversationId?.trim() ?? '')
                .filter((item) => item.length > 0),
            ),
          )

    const conversations = await Promise.all(
      conversationIds.map(async (conversationId) => {
        const details = await getConversationDetails(conversationId)
        const scopedMessages =
          scope === 'all' ? details.messages : details.messages.filter((message) => isExternalMessage(message))
        const pagedMessages = fetchAll ? scopedMessages : scopedMessages.slice(offset, offset + limit)
        const normalizedMessages = pagedMessages.map((message) => {
          const metadata = (message.metadata ?? {}) as Record<string, unknown>
          const heroImageUrl = readText(metadata.heroImageUrl)
          const imageUrl = readText(metadata.imageUrl)
          const imageLinkUrl = readText(metadata.imageLinkUrl)
          const imageAssetPath = readText(metadata.imageAssetPath)
          const originalImageUrl = readText(metadata.originalImageUrl)
          const imageId = extractImageId({
            imageAssetPath,
            imageUrl,
            heroImageUrl,
            imageLinkUrl,
          })
          const objectType = readText((metadata.object as Record<string, unknown> | undefined)?.type)
          const objectId = readText((metadata.object as Record<string, unknown> | undefined)?.id)
          const objectRefs = [
            {
              objectType,
              objectId,
              label: readText((metadata.object as Record<string, unknown> | undefined)?.label),
            },
          ].filter((item) => item.objectType || item.objectId || item.label)
          return {
            messageId: message.messageId,
            role: message.role,
            eventType: message.eventType,
            createdAt: message.createdAt,
            content: message.content,
            imageRefs: {
              imageId,
              heroImageUrl,
              imageUrl,
              imageLinkUrl,
              imageAssetPath,
              originalImageUrl,
            },
            objectRefs,
            metadata,
          }
        })
        const imageCandidates = normalizedMessages
          .filter((message) => message.imageRefs.imageUrl || message.imageRefs.heroImageUrl)
          .map((message) => ({
            messageId: message.messageId,
            imageId: message.imageRefs.imageId,
            imageUrl: message.imageRefs.imageUrl ?? message.imageRefs.heroImageUrl,
            summary:
              readSceneSummaryValue(message.metadata) ??
              readCanonicalStoryText({
                metadata: message.metadata,
                fallbackSummary: message.content,
              }),
            imagePrompt: readImagePromptValue(message.metadata),
            source: 'message-metadata' as const,
          }))

        return {
          conversationId,
          characterId: details.conversation.characterId,
          startedAt: details.conversation.startedAt,
          endedAt: details.conversation.endedAt,
          messageCount: scopedMessages.length,
          hasMore: fetchAll ? false : scopedMessages.length > offset + pagedMessages.length,
          nextOffset: fetchAll ? scopedMessages.length : offset + pagedMessages.length,
          messages: normalizedMessages,
          imageCandidates,
        }
      }),
    )

    await trackRuntimeToolActivitySafely({
      activityType: 'tool.conversation_history.read',
      characterId: context.characterId,
      characterName: context.characterName,
      conversationId: context.conversationId,
      learningGoalIds: context.learningGoalIds,
      object: {
        type: 'conversation_history',
        scope,
      },
      metadata: {
        summary: `${context.characterName} liest Conversation-Historie`,
        toolId: CHARACTER_AGENT_TOOLS.readConversationHistory,
        scope,
        conversationCount: conversations.length,
        limit,
        offset,
        fetchAll,
      },
    })

    await trackTraceActivitySafely({
      activityType: 'trace.tool.read_conversation_history.response',
      summary: `${context.characterName} beendet read_conversation_history`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'response',
      traceSource: 'runtime',
      output: {
        scope,
        limit,
        offset,
        conversationCount: conversations.length,
        fetchAll,
      },
      ok: true,
    })

    return {
      scope,
      limit,
      offset,
      conversations,
    }
  },
}
