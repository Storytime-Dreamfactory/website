import { appendConversationMessage } from '../../conversationStore.ts'
import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import { listRelationshipsByOtherRelatedObject } from '../../relationshipStore.ts'
import { trackTraceActivitySafely } from '../../traceActivity.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { trackRuntimeToolActivitySafely } from './runtimeToolActivityLogger.ts'
import { collateRelatedCharacterObjects } from '../context/contextCollationService.ts'

type ReadRelatedObjectContextsToolInput = {
  objectType: string
  objectId: string
}

type ReadRelatedObjectContextsToolOutput = {
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

export const readRelatedObjectContextsTool: RuntimeToolHandler<
  ReadRelatedObjectContextsToolInput,
  ReadRelatedObjectContextsToolOutput
> = {
  id: CHARACTER_AGENT_TOOLS.readRelatedObjectContexts,
  execute: async (context, input) => {
    await trackTraceActivitySafely({
      activityType: 'trace.tool.read_related_object_contexts.request',
      summary: `${context.characterName} startet read_related_object_contexts`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'request',
      traceSource: 'runtime',
      input,
    })

    const objectType = input.objectType?.trim() || ''
    const objectId = input.objectId?.trim() || ''
    if (!objectType || !objectId) {
      throw new Error('objectType und objectId sind erforderlich.')
    }

    const matches = await listRelationshipsByOtherRelatedObject(objectType, objectId)
    const relatedCharacterIds = Array.from(
      new Set(
        matches.flatMap((entry) => [
          entry.relationship.sourceCharacterId,
          entry.relationship.targetCharacterId,
        ]),
      ),
    )
      .filter((id) => id && id !== context.characterId)
      .slice(0, 20)
    const matchedContexts = matches.slice(0, 20).map((entry) => ({
      relationshipId: entry.relationship.relationshipId,
      sourceCharacterId: entry.relationship.sourceCharacterId,
      targetCharacterId: entry.relationship.targetCharacterId,
      relationshipType: entry.relationship.relationshipType,
      relationshipTypeReadable: entry.relationship.relationshipTypeReadable,
      relationship: entry.relationship.relationship,
      matchedObject: entry.matchedObject,
    }))
    const relatedObjects = await collateRelatedCharacterObjects({
      relatedCharacterIds,
      relationshipLinks: matchedContexts.map((match) => ({
        relatedCharacterId:
          match.sourceCharacterId === context.characterId
            ? match.targetCharacterId
            : match.sourceCharacterId,
        direction: match.sourceCharacterId === context.characterId ? 'outgoing' : 'incoming',
        relationshipType: match.relationshipType,
        relationshipTypeReadable: match.relationshipTypeReadable,
        relationship: match.relationship,
      })),
    })

    await trackRuntimeToolActivitySafely({
      activityType: 'tool.related_object_contexts.read',
      characterId: context.characterId,
      characterName: context.characterName,
      conversationId: context.conversationId,
      learningGoalIds: context.learningGoalIds,
      object: {
        type: objectType,
        id: objectId,
      },
      metadata: {
        summary: `${context.characterName} sucht Kontexte fuer ein Related Object`,
        toolId: CHARACTER_AGENT_TOOLS.readRelatedObjectContexts,
        objectType,
        objectId,
        matchCount: matches.length,
        relatedCharacterIds,
        matchedContexts,
        stage: 'runtime-router',
      },
    })

    if (matches.length > 0) {
      await appendConversationMessage({
        conversationId: context.conversationId,
        role: 'system',
        content: `${context.characterName} hat Beziehungs-Kontexte fuer ein Related Object geladen.`,
        eventType: 'tool.related_object_contexts.loaded',
        metadata: {
          skillId: 'guided-explanation',
          toolId: CHARACTER_AGENT_TOOLS.readRelatedObjectContexts,
          objectType,
          objectId,
          matches: matchedContexts,
          relatedObjects,
          relatedCharacterIds,
        },
      })
    }

    await trackTraceActivitySafely({
      activityType: 'trace.tool.read_related_object_contexts.response',
      summary: `${context.characterName} beendet read_related_object_contexts`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'response',
      traceSource: 'runtime',
      output: {
        objectType,
        objectId,
        matchCount: matches.length,
        relatedCharacterIds,
        matchedContexts,
        relatedObjects,
      },
      ok: true,
    })

    return {
      matchCount: matches.length,
      relatedCharacterIds,
      matchedContexts,
      relatedObjects: relatedObjects.map((item) => ({
        objectType: item.objectType,
        objectId: item.objectId,
        displayName: item.displayName,
        species: item.species,
        shortDescription: item.shortDescription,
        imageRefs: item.imageRefs,
      })),
    }
  },
}
