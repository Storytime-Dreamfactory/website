import { appendConversationMessage } from '../../conversationStore.ts'
import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import { loadCharacterRuntimeProfiles } from '../../runtimeContentStore.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { trackRuntimeToolActivitySafely } from './runtimeToolActivityLogger.ts'

type ReadRelatedObjectsToolInput = {
  relatedCharacterIds: string[]
}

type ReadRelatedObjectsToolOutput = {
  relatedObjectCount: number
}

export const readRelatedObjectsTool: RuntimeToolHandler<
  ReadRelatedObjectsToolInput,
  ReadRelatedObjectsToolOutput
> = {
  id: CHARACTER_AGENT_TOOLS.readRelatedObjects,
  execute: async (context, input) => {
    const relatedProfiles = await loadCharacterRuntimeProfiles(input.relatedCharacterIds)
    const relatedObjectSummaries = relatedProfiles.map((profile) => ({
      characterId: profile.id,
      name: profile.name,
      species: profile.species || undefined,
      shortDescription: profile.shortDescription || undefined,
      coreTraits: profile.coreTraits.slice(0, 4),
    }))
    const relatedObjectCount = relatedObjectSummaries.length

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
        relatedObjectIds: relatedObjectSummaries.map((item) => item.characterId),
        stage: 'runtime-router',
      },
    })

    if (relatedObjectSummaries.length > 0) {
      await appendConversationMessage({
        conversationId: context.conversationId,
        role: 'system',
        content: `${context.characterName} hat Kontext ueber verknuepfte Figuren geladen.`,
        eventType: 'tool.relationships.context.loaded',
        metadata: {
          skillId: 'guided-explanation',
          toolId: CHARACTER_AGENT_TOOLS.readRelatedObjects,
          relatedObjects: relatedObjectSummaries,
        },
      })
    }

    return { relatedObjectCount }
  },
}
