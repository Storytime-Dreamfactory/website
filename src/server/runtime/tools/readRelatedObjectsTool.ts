import { appendConversationMessage } from '../../conversationStore.ts'
import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import { trackTraceActivitySafely } from '../../traceActivity.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { trackRuntimeToolActivitySafely } from './runtimeToolActivityLogger.ts'
import {
  collateRelatedCharacterObjects,
} from '../context/contextCollationService.ts'

type RelationshipLinkInput = {
  relatedCharacterId: string
  direction: 'outgoing' | 'incoming'
  relationshipType: string
  relationshipTypeReadable: string
  relationship: string
  description?: string
  metadata?: Record<string, unknown>
  otherRelatedObjects?: Array<{
    type: string
    id: string
    label?: string
    metadata?: Record<string, unknown>
  }>
}

type ReadRelatedObjectsToolInput = {
  relatedCharacterIds: string[]
  relationshipLinks?: RelationshipLinkInput[]
}

type ReadRelatedObjectsToolOutput = {
  relatedObjectCount: number
  relatedObjects: Array<{
    objectType: string
    objectId: string
    displayName: string
    species?: string
    shortDescription?: string
    relationshipLinks: RelationshipLinkInput[]
    imageRefs: Array<{
      kind: 'hero' | 'standard' | 'portrait' | 'profile'
      title: string
      path: string
    }>
    evidence: string[]
  }>
}

export const readRelatedObjectsTool: RuntimeToolHandler<
  ReadRelatedObjectsToolInput,
  ReadRelatedObjectsToolOutput
> = {
  id: CHARACTER_AGENT_TOOLS.readRelatedObjects,
  execute: async (context, input) => {
    await trackTraceActivitySafely({
      activityType: 'trace.tool.read_related_objects.request',
      summary: `${context.characterName} startet read_related_objects`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'request',
      traceSource: 'runtime',
      input,
    })
    const relatedObjects = await collateRelatedCharacterObjects({
      relatedCharacterIds: input.relatedCharacterIds,
      relationshipLinks: input.relationshipLinks,
    })
    const relatedObjectCount = relatedObjects.length

    await trackRuntimeToolActivitySafely({
      activityType: 'tool.related_objects.read',
      characterId: context.characterId,
      characterName: context.characterName,
      conversationId: context.conversationId,
      learningGoalIds: context.learningGoalIds,
      object: {
        type: 'related_objects',
        scope: 'relationship-context',
      },
      metadata: {
        summary: `${context.characterName} liest Wissen ueber verknuepfte Figuren`,
        toolId: CHARACTER_AGENT_TOOLS.readRelatedObjects,
        relatedObjectCount,
        relatedObjectIds: relatedObjects.map((item) => item.objectId),
        stage: 'runtime-router',
      },
    })

    if (relatedObjects.length > 0) {
      await appendConversationMessage({
        conversationId: context.conversationId,
        role: 'system',
        content: `${context.characterName} hat Kontext ueber verknuepfte Figuren geladen.`,
        eventType: 'tool.relationships.context.loaded',
        metadata: {
          skillId: 'guided-explanation',
          toolId: CHARACTER_AGENT_TOOLS.readRelatedObjects,
          relatedObjects,
        },
      })
    }

    await trackTraceActivitySafely({
      activityType: 'trace.tool.read_related_objects.response',
      summary: `${context.characterName} beendet read_related_objects`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'response',
      traceSource: 'runtime',
      output: {
        relatedObjectCount,
        relatedObjectIds: relatedObjects.map((item) => item.objectId),
        relatedObjects,
      },
      ok: true,
    })

    return { relatedObjectCount, relatedObjects }
  },
}
