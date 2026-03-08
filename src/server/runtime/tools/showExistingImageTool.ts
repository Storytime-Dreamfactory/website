import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import { recallConversationImage, type RecalledConversationImage } from '../../conversationImageMemoryToolService.ts'
import { trackTraceActivitySafely } from '../../traceActivity.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'

type ShowImageInput = {
  queryText?: string
  preferredImageUrl?: string
  preferredImageId?: string
  source?: 'runtime' | 'api'
}

export const showImageTool: RuntimeToolHandler<
  ShowImageInput,
  RecalledConversationImage | null
> = {
  id: CHARACTER_AGENT_TOOLS.showImage,
  execute: async (context, input) => {
    await trackTraceActivitySafely({
      activityType: 'trace.tool.show_image.request',
      summary: `${context.characterName} startet show_image`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'request',
      traceSource: input.source ?? 'runtime',
      input,
    })
    const result = await recallConversationImage({
      conversationId: context.conversationId,
      queryText: input.queryText,
      preferredImageUrl: input.preferredImageUrl,
      preferredImageId: input.preferredImageId,
      source: input.source ?? 'runtime',
    })
    await trackTraceActivitySafely({
      activityType: 'trace.tool.show_image.response',
      summary: `${context.characterName} beendet show_image`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'response',
      traceSource: input.source ?? 'runtime',
      output: result,
      ok: Boolean(result),
      error: result ? undefined : 'no-image-found',
    })
    return result
  },
}
