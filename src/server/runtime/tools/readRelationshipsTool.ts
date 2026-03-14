import {
  listRelationshipsByOtherRelatedObject,
  listRelationshipsForCharacter,
} from '../../relationshipStore.ts'
import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import { trackTraceActivitySafely } from '../../traceActivity.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { trackRuntimeToolActivitySafely } from './runtimeToolActivityLogger.ts'

type ReadRelationshipsToolOutput = {
  relationshipCount: number
  relatedCharacterIds: string[]
  objectMatchCount: number
  relationshipLinks: Array<{
    relatedCharacterId: string
    direction: 'outgoing' | 'incoming'
    relationshipType: string
    fromTitle: string
    toTitle: string
    relationshipTypeReadable: string
    relationship: string
    description?: string
    properties?: Record<string, unknown>
    /** @deprecated Use properties instead. */
    metadata?: Record<string, unknown>
    otherRelatedObjects: Array<{
      type: string
      id: string
      label?: string
      metadata?: Record<string, unknown>
    }>
  }>
}

type ReadRelationshipsToolInput = {
  objectType?: string
  objectId?: string
}

export const readRelationshipsTool: RuntimeToolHandler<ReadRelationshipsToolInput, ReadRelationshipsToolOutput> = {
    id: CHARACTER_AGENT_TOOLS.readRelationships,
    execute: async (context, input) => {
      await trackTraceActivitySafely({
        activityType: 'trace.tool.read_relationships.request',
        summary: `${context.characterName} startet read_relationships`,
        conversationId: context.conversationId,
        characterId: context.characterId,
        characterName: context.characterName,
        learningGoalIds: context.learningGoalIds,
        traceStage: 'tool',
        traceKind: 'request',
        traceSource: 'runtime',
      })
      const relationships = await listRelationshipsForCharacter(context.characterId)
      const relationshipCount = relationships.length
      const relatedCharacterIdsFromDirectRelationships = Array.from(
        new Set(
          relationships.map((relationship) =>
            relationship.direction === 'outgoing'
              ? relationship.targetCharacterId
              : relationship.sourceCharacterId,
          ),
        ),
      ).filter((id) => id && id !== context.characterId)

      const objectType = input.objectType?.trim() || ''
      const objectId = input.objectId?.trim() || ''
      const reverseMatches =
        objectType && objectId
          ? await listRelationshipsByOtherRelatedObject(objectType, objectId)
          : []

      const relatedCharacterIdsFromObjectLookup = reverseMatches.flatMap((entry) => [
        entry.relationship.sourceCharacterId,
        entry.relationship.targetCharacterId,
      ])

      const relatedCharacterIds = Array.from(
        new Set([
          ...relatedCharacterIdsFromDirectRelationships,
          ...relatedCharacterIdsFromObjectLookup,
        ]),
      ).filter((id) => id && id !== context.characterId)

      const relationshipLinks = relationships.map((item) => ({
        relatedCharacterId:
          item.direction === 'outgoing' ? item.targetCharacterId : item.sourceCharacterId,
        direction: item.direction,
        relationshipType: item.relationshipType,
        fromTitle: item.fromTitle,
        toTitle: item.toTitle,
        relationshipTypeReadable: item.relationshipTypeReadable,
        relationship: item.relationship,
        description: item.description,
        properties: item.properties,
        metadata: item.properties ?? item.metadata,
        otherRelatedObjects: item.otherRelatedObjects,
      }))

      await trackRuntimeToolActivitySafely({
        activityType: 'tool.relationships.read',
        characterId: context.characterId,
        characterName: context.characterName,
        conversationId: context.conversationId,
        learningGoalIds: context.learningGoalIds,
        object: {
          type: 'relationships',
          scope: 'runtime-routing',
        },
        metadata: {
          summary: `${context.characterName} schaut fuer die Runtime ins Beziehungsnetz`,
          toolId: CHARACTER_AGENT_TOOLS.readRelationships,
          relationshipCount,
          objectType: objectType || undefined,
          objectId: objectId || undefined,
          objectMatchCount: reverseMatches.length,
          stage: 'runtime-router',
        },
      })

      await trackTraceActivitySafely({
        activityType: 'trace.tool.read_relationships.response',
        summary: `${context.characterName} beendet read_relationships`,
        conversationId: context.conversationId,
        characterId: context.characterId,
        characterName: context.characterName,
        learningGoalIds: context.learningGoalIds,
        traceStage: 'tool',
        traceKind: 'response',
        traceSource: 'runtime',
        output: {
          relationshipCount,
          relatedCharacterIds,
          relationshipLinks,
          objectType: objectType || undefined,
          objectId: objectId || undefined,
          objectMatchCount: reverseMatches.length,
        },
        ok: true,
      })

      return {
        relationshipCount,
        relatedCharacterIds,
        objectMatchCount: reverseMatches.length,
        relationshipLinks,
      }
    },
  }
