import {
  appendConversationMessage,
  endConversation,
  getConversationDetails,
  mergeConversationMetadata,
  startConversation,
  type ConversationMetadata,
  type ConversationMessageRecord,
  type ConversationRecord,
} from './conversationStore.ts'
import { createActivity } from './activityStore.ts'
import { trackTraceActivitySafely } from './traceActivity.ts'
import { triggerConversationEndedService } from './conversationLifecycleService.ts'
import {
  buildPublicConversationMessageSummary,
  formatCharacterDisplayName,
  isPublicConversationMessageRole,
  resolveCounterpartName,
} from './conversationActivityHelpers.ts'
import { createConversationEndSummary } from './conversationEndSummaryService.ts'
import { orchestrateCharacterRuntimeTurn } from './characterRuntimeOrchestrator.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'

type RuntimeActorMetadata = {
  actorType?: string
  actorId?: string
  source?: string
}

const CONVERSATION_LINK_LABEL = 'Conversation ansehen'

const sameStringArray = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) return false
  return left.every((item, index) => item === right[index])
}

const readText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const isRealtimeAssistantEvent = (role: string, eventType: string | undefined): boolean => {
  return role === 'assistant' && Boolean(eventType?.startsWith('response.'))
}

const resolveRuntimeActorMetadata = (input: {
  role: string
  eventType?: string
  characterId?: string
  metadata?: ConversationMetadata
}): RuntimeActorMetadata => {
  const metadata = input.metadata ?? {}
  const actorType = readText(metadata.actorType)
  const actorId = readText(metadata.actorId)
  const source = readText(metadata.source)
  if (actorType || actorId || source) {
    return {
      actorType,
      actorId,
      source,
    }
  }

  if (isRealtimeAssistantEvent(input.role, input.eventType) && input.characterId) {
    return {
      actorType: 'character',
      actorId: input.characterId,
      source: 'realtime',
    }
  }

  if (input.role === 'user') {
    return {
      actorType: 'user',
      source: input.eventType?.startsWith('response.') ? 'realtime' : 'api',
    }
  }

  if (input.role === 'assistant') {
    return {
      actorType: 'assistant',
      source: input.eventType?.startsWith('response.') ? 'realtime' : 'api',
    }
  }

  return {
    source: input.eventType?.startsWith('response.') ? 'realtime' : 'api',
  }
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

const runOrchestration = async (input: {
  message: ConversationMessageRecord
  role: string
  content: string
  eventType?: string
  conversationId: string
  conversationCharacterId?: string
  conversationLearningGoalIds?: string[]
  runRuntimeSynchronously: boolean
}): Promise<void> => {
  if (input.role !== 'user' && input.role !== 'assistant') return

  await trackTraceActivitySafely({
    activityType: 'trace.runtime.orchestration.request',
    summary: 'Runtime-Orchestrierung gestartet',
    conversationId: input.conversationId,
    characterId: input.conversationCharacterId,
    learningGoalIds: input.conversationLearningGoalIds,
    traceStage: 'routing',
    traceKind: 'request',
    traceSource: 'runtime',
    input: {
      role: input.role,
      eventType: input.eventType,
    },
  })

  const runtimePromise = orchestrateCharacterRuntimeTurn({
    conversationId: input.conversationId,
    role: input.role as 'user' | 'assistant',
    content: input.content,
    eventType: input.eventType,
    messageId: input.message.messageId,
    actorType:
      typeof input.message.metadata?.actorType === 'string'
        ? input.message.metadata.actorType
        : undefined,
    actorId:
      typeof input.message.metadata?.actorId === 'string'
        ? input.message.metadata.actorId
        : undefined,
  }).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`Character runtime orchestration failed: ${reason}`)
    return trackTraceActivitySafely({
      activityType: 'trace.runtime.orchestration.error',
      summary: 'Runtime-Orchestrierung fehlgeschlagen',
      conversationId: input.conversationId,
      characterId: input.conversationCharacterId,
      learningGoalIds: input.conversationLearningGoalIds,
      traceStage: 'routing',
      traceKind: 'error',
      traceSource: 'runtime',
      ok: false,
      error: reason,
    })
  })

  if (input.runRuntimeSynchronously) {
    await runtimePromise
  } else {
    void runtimePromise
  }
}

export const startConversationFlow = async (input: {
  characterId: string
  userId?: string
  metadata?: ConversationMetadata
}): Promise<{ conversation: ConversationRecord }> => {
  const conversation = await startConversation({
    characterId: input.characterId,
    userId: input.userId,
    metadata: input.metadata,
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

  return { conversation }
}

export const mergeConversationFlowMetadata = async (input: {
  conversationId: string
  metadata?: ConversationMetadata
}): Promise<{ conversation: ConversationRecord }> => {
  const previousDetails = await getConversationDetails(input.conversationId)
  const previousContext = contextFromMetadata(previousDetails.conversation.metadata)
  const conversation = await mergeConversationMetadata({
    conversationId: input.conversationId,
    metadata: input.metadata,
  })
  const context = contextFromMetadata(conversation.metadata)
  const previousLearningGoalIds = previousContext.learningGoalIds ?? []
  const nextLearningGoalIds = context.learningGoalIds ?? []
  const learningGoalChanged = !sameStringArray(previousLearningGoalIds, nextLearningGoalIds)

  if (learningGoalChanged) {
    await trackActivitySafely({
      activityType:
        nextLearningGoalIds.length > 0
          ? 'conversation.learning_goal.updated'
          : 'conversation.learning_goal.cleared',
      isPublic: false,
      characterId: conversation.characterId,
      placeId: context.placeId,
      learningGoalIds: nextLearningGoalIds,
      conversationId: conversation.conversationId,
      subject: {
        type: 'conversation',
        id: conversation.conversationId,
      },
      object:
        nextLearningGoalIds.length > 0
          ? {
              type: 'learning_goals',
              ids: nextLearningGoalIds,
            }
          : {
              type: 'learning_goals',
              ids: [],
            },
      metadata: {
        ...(conversation.metadata ?? {}),
        previousLearningGoalIds,
        summary:
          nextLearningGoalIds.length > 0
            ? `Lernziel aktualisiert: ${nextLearningGoalIds.join(', ')}`
            : 'Lernziel entfernt',
      },
    })
  }

  return { conversation }
}

export const appendConversationFlowMessage = async (input: {
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  eventType?: string
  metadata?: ConversationMetadata
  runRuntimeSynchronously?: boolean
}): Promise<{ message: ConversationMessageRecord }> => {
  const conversationId = input.conversationId
  const role = input.role
  const content = input.content
  const eventType = input.eventType
  const metadata = input.metadata
  let conversationCharacterId: string | undefined
  let conversationLearningGoalIds: string[] | undefined
  let conversationMetadata: ConversationMetadata | undefined
  try {
    const details = await getConversationDetails(conversationId)
    conversationCharacterId = details.conversation.characterId
    conversationMetadata = details.conversation.metadata
    const context = contextFromMetadata(details.conversation.metadata)
    conversationLearningGoalIds = context.learningGoalIds
  } catch {
    // Falls die Conversation nicht aufgeloest werden kann, behalten wir den Fallback.
  }

  await trackTraceActivitySafely({
    activityType: 'trace.conversation.input.request',
    summary: 'Conversation message eingegangen',
    conversationId,
    characterId: conversationCharacterId,
    learningGoalIds: conversationLearningGoalIds,
    traceStage: 'ingress',
    traceKind: 'request',
    traceSource: eventType?.startsWith('response.') ? 'realtime' : 'api',
    input: {
      role,
      eventType,
      contentPreview: content.slice(0, 240),
    },
  })

  const runtimeActorMetadata = resolveRuntimeActorMetadata({
    role,
    eventType,
    characterId: conversationCharacterId,
    metadata,
  })
  const enrichedMessageMetadata: ConversationMetadata = {
    ...(metadata ?? {}),
    ...(runtimeActorMetadata.actorType ? { actorType: runtimeActorMetadata.actorType } : {}),
    ...(runtimeActorMetadata.actorId ? { actorId: runtimeActorMetadata.actorId } : {}),
    ...(runtimeActorMetadata.source ? { source: runtimeActorMetadata.source } : {}),
  }

  const message = await appendConversationMessage({
    conversationId,
    role,
    content,
    eventType,
    metadata: enrichedMessageMetadata,
  })
  const context = contextFromMetadata(message.metadata)
  await trackActivitySafely({
    activityType: 'conversation.message.created',
    isPublic: isPublicConversationMessageRole(message.role),
    characterId: conversationCharacterId,
    placeId: context.placeId,
    learningGoalIds: context.learningGoalIds ?? conversationLearningGoalIds,
    conversationId: message.conversationId,
    subject: {
      type: message.role === 'assistant' ? 'character' : 'person',
      id:
        message.role === 'assistant'
          ? conversationCharacterId ?? 'character'
          : resolveCounterpartName(conversationMetadata).toLowerCase(),
      name:
        message.role === 'assistant'
          ? formatCharacterDisplayName(conversationCharacterId ?? 'Character')
          : resolveCounterpartName(conversationMetadata),
    },
    object: {
      type: 'conversation_message',
      id: String(message.messageId),
      role: message.role,
      eventType: message.eventType,
    },
    metadata: {
      ...message.metadata,
      messageRole: message.role,
      summary: buildPublicConversationMessageSummary({
        role: message.role,
        content: message.content,
        characterId: conversationCharacterId,
        conversationMetadata,
      }),
    },
  })

  await runOrchestration({
    message,
    role,
    content,
    eventType,
    conversationId,
    conversationCharacterId,
    conversationLearningGoalIds,
    runRuntimeSynchronously: input.runRuntimeSynchronously === true,
  })

  return { message }
}

export const endConversationFlow = async (input: {
  conversationId: string
  metadata?: ConversationMetadata
}): Promise<{ conversation: ConversationRecord }> => {
  let conversation = await endConversation(input.conversationId, { metadata: input.metadata })
  let context = contextFromMetadata(conversation.metadata)
  const characterDisplayName = formatCharacterDisplayName(conversation.characterId)
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
    metadata: {
      ...(conversation.metadata ?? {}),
      conversationLinkLabel: CONVERSATION_LINK_LABEL,
    },
  })
  try {
    const summaryResult = await createConversationEndSummary(conversation)
    conversation = summaryResult.conversation
    context = contextFromMetadata(conversation.metadata)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Conversation end summary failed: ${message}`)
  }
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

  return { conversation }
}
