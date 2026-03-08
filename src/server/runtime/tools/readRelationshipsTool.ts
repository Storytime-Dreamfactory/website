import { listRelationshipsForCharacter } from '../../relationshipStore.ts'
import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { trackRuntimeToolActivitySafely } from './runtimeToolActivityLogger.ts'

type ReadRelationshipsToolOutput = {
  relationshipCount: number
  relatedCharacterIds: string[]
}

export const readRelationshipsTool: RuntimeToolHandler<Record<string, never>, ReadRelationshipsToolOutput> =
  {
    id: CHARACTER_AGENT_TOOLS.readRelationships,
    execute: async (context) => {
      const relationships = await listRelationshipsForCharacter(context.characterId)
      const relationshipCount = relationships.length
      const relatedCharacterIds = Array.from(
        new Set(
          relationships.map((relationship) =>
            relationship.direction === 'outgoing'
              ? relationship.targetCharacterId
              : relationship.sourceCharacterId,
          ),
        ),
      ).filter((id) => id && id !== context.characterId)

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
          stage: 'runtime-router',
        },
      })

      return {
        relationshipCount,
        relatedCharacterIds,
      }
    },
  }
