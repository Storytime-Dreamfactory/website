import { listActivities } from '../../activityStore.ts'
import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { trackRuntimeToolActivitySafely } from './runtimeToolActivityLogger.ts'

type ReadActivitiesToolInput = {
  limit?: number
}

type ReadActivitiesToolOutput = {
  activityCount: number
}

export const readActivitiesTool: RuntimeToolHandler<
  ReadActivitiesToolInput,
  ReadActivitiesToolOutput
> = {
  id: CHARACTER_AGENT_TOOLS.readActivities,
  execute: async (context, input) => {
    const activities = await listActivities({
      conversationId: context.conversationId,
      limit: typeof input.limit === 'number' ? input.limit : 12,
    })
    const activityCount = activities.length

    await trackRuntimeToolActivitySafely({
      activityType: 'tool.activities.read',
      characterId: context.characterId,
      characterName: context.characterName,
      conversationId: context.conversationId,
      learningGoalIds: context.learningGoalIds,
      object: {
        type: 'activities',
        scope: 'runtime-routing',
      },
      metadata: {
        summary: `${context.characterName} schaut fuer die Runtime in letzte Activities`,
        toolId: CHARACTER_AGENT_TOOLS.readActivities,
        activityCount,
        stage: 'runtime-router',
      },
    })

    return { activityCount }
  },
}
