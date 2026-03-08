import { CHARACTER_AGENT_TOOLS, type CharacterAgentToolId } from '../../characterAgentDefinitions.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { readActivitiesTool } from './readActivitiesTool.ts'
import { readRelationshipsTool } from './readRelationshipsTool.ts'
import { readRelatedObjectsTool } from './readRelatedObjectsTool.ts'

const runtimeToolsById = new Map<CharacterAgentToolId, RuntimeToolHandler<any, any>>([
  [readActivitiesTool.id, readActivitiesTool],
  [readRelationshipsTool.id, readRelationshipsTool],
  [readRelatedObjectsTool.id, readRelatedObjectsTool],
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
  getRuntimeToolHandler<{ limit?: number }, { activityCount: number }>(
    CHARACTER_AGENT_TOOLS.readActivities,
  )

export const readRelationshipsRuntimeTool = () =>
  getRuntimeToolHandler<Record<string, never>, { relationshipCount: number; relatedCharacterIds: string[] }>(
    CHARACTER_AGENT_TOOLS.readRelationships,
  )

export const readRelatedObjectsRuntimeTool = () =>
  getRuntimeToolHandler<{ relatedCharacterIds: string[] }, { relatedObjectCount: number }>(
    CHARACTER_AGENT_TOOLS.readRelatedObjects,
  )
