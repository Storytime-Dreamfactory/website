import { CHARACTER_AGENT_TOOLS, type CharacterAgentToolId } from '../../characterAgentDefinitions.ts'
import type { RecalledConversationImage } from '../../conversationImageMemoryToolService.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { readActivitiesTool } from './readActivitiesTool.ts'
import { readConversationHistoryTool } from './readConversationHistoryTool.ts'
import { readRelationshipsTool } from './readRelationshipsTool.ts'
import { readRelatedObjectsTool } from './readRelatedObjectsTool.ts'
import { readRelatedObjectContextsTool } from './readRelatedObjectContextsTool.ts'
import { type CliTaskId, runCliTaskTool } from './runCliTaskTool.ts'
import { showImageTool } from './showExistingImageTool.ts'

const runtimeToolsById = new Map<CharacterAgentToolId, RuntimeToolHandler<any, any>>([
  [readActivitiesTool.id, readActivitiesTool],
  [readConversationHistoryTool.id, readConversationHistoryTool],
  [readRelationshipsTool.id, readRelationshipsTool],
  [readRelatedObjectsTool.id, readRelatedObjectsTool],
  [readRelatedObjectContextsTool.id, readRelatedObjectContextsTool],
  [showImageTool.id, showImageTool],
  [runCliTaskTool.id, runCliTaskTool],
])

export const getRuntimeToolHandler = <TInput, TOutput>(
  toolId: CharacterAgentToolId,
): RuntimeToolHandler<TInput, TOutput> => {
  const handler = runtimeToolsById.get(toolId)
  if (!handler) {
    throw new Error(`Runtime tool not registered: ${toolId}`)
  }
  return handler as RuntimeToolHandler<TInput, TOutput>
}

export const readActivitiesRuntimeTool = () =>
  getRuntimeToolHandler<
    { limit?: number; offset?: number; scope?: 'external' | 'all'; conversationId?: string },
    {
      activityCount: number
      hasMore: boolean
      nextOffset: number
      items: Array<{
        activityId: string
        activityType: string
        isPublic: boolean
        conversationId?: string
        occurredAt: string
        createdAt: string
        objectType?: string
        objectId?: string
        imageRefs: {
          imageId?: string
          heroImageUrl?: string
          imageUrl?: string
          imageLinkUrl?: string
          imageAssetPath?: string
          originalImageUrl?: string
        }
        summary?: string
        metadata: Record<string, unknown>
      }>
    }
  >(
    CHARACTER_AGENT_TOOLS.readActivities,
  )

export const readConversationHistoryRuntimeTool = () =>
  getRuntimeToolHandler<
    { conversationIds?: string[]; scope?: 'external' | 'all'; limit?: number; offset?: number },
    {
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
          scenePrompt?: string
          source: 'message-metadata'
        }>
      }>
    }
  >(CHARACTER_AGENT_TOOLS.readConversationHistory)

export const readRelationshipsRuntimeTool = () =>
  getRuntimeToolHandler<
    { objectType?: string; objectId?: string },
    {
      relationshipCount: number
      relatedCharacterIds: string[]
      objectMatchCount: number
      relationshipLinks: Array<{
        relatedCharacterId: string
        direction: 'outgoing' | 'incoming'
        relationshipType: string
        relationshipTypeReadable: string
        relationship: string
        description?: string
        metadata?: Record<string, unknown>
        otherRelatedObjects: Array<{
          type: string
          id: string
          label?: string
          metadata?: Record<string, unknown>
        }>
      }>
    }
  >(CHARACTER_AGENT_TOOLS.readRelationships)

export const readRelatedObjectsRuntimeTool = () =>
  getRuntimeToolHandler<
    {
      relatedCharacterIds: string[]
      relationshipLinks?: Array<{
        relatedCharacterId: string
        direction: 'outgoing' | 'incoming'
        relationshipType: string
        relationshipTypeReadable: string
        relationship: string
        description?: string
        metadata?: Record<string, unknown>
        otherRelatedObjects: Array<{
          type: string
          id: string
          label?: string
          metadata?: Record<string, unknown>
        }>
      }>
    },
    {
      relatedObjectCount: number
      relatedObjects: Array<{
        objectType: string
        objectId: string
        displayName: string
        species?: string
        shortDescription?: string
        relationshipLinks: Array<{
          relatedCharacterId: string
          direction: 'outgoing' | 'incoming'
          relationshipType: string
          relationshipTypeReadable: string
          relationship: string
          description?: string
          metadata?: Record<string, unknown>
        }>
        imageRefs: Array<{
          kind: 'hero' | 'standard' | 'portrait' | 'profile'
          title: string
          path: string
        }>
        evidence: string[]
      }>
    }
  >(
    CHARACTER_AGENT_TOOLS.readRelatedObjects,
  )

export const readRelatedObjectContextsRuntimeTool = () =>
  getRuntimeToolHandler<
    { objectType: string; objectId: string },
    {
      matchCount: number
      relatedCharacterIds: string[]
      matchedContexts: Array<{
        relationshipId: string
        sourceCharacterId: string
        targetCharacterId: string
        relationshipType: string
        relationshipTypeReadable: string
        relationship: string
        matchedObject: {
          type: string
          id: string
          label?: string
          metadata?: Record<string, unknown>
        }
      }>
      relatedObjects: Array<{
        objectType: string
        objectId: string
        displayName: string
        species?: string
        shortDescription?: string
        imageRefs: Array<{
          kind: 'hero' | 'standard' | 'portrait' | 'profile'
          title: string
          path: string
        }>
      }>
    }
  >(CHARACTER_AGENT_TOOLS.readRelatedObjectContexts)

export const runCliTaskRuntimeTool = () =>
  getRuntimeToolHandler<
    { taskId: CliTaskId; args?: Record<string, unknown>; dryRun?: boolean },
    {
      ok: boolean
      exitCode: number
      stdout: string
      stderr: string
      durationMs: number
      commandPreview: string
    }
  >(CHARACTER_AGENT_TOOLS.runCliTask)

export const showImageRuntimeTool = () =>
  getRuntimeToolHandler<
    {
      queryText?: string
      preferredImageUrl?: string
      preferredImageId?: string
      source?: 'runtime' | 'api'
    },
    RecalledConversationImage | null
  >(
    CHARACTER_AGENT_TOOLS.showImage,
  )
