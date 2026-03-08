import { runConversationQuizSkill } from '../../conversationQuizToolService.ts'
import { recallConversationImage } from '../../conversationImageMemoryToolService.ts'
import { maybeGenerateSceneImageFromAssistantMessage } from '../../conversationSceneImageService.ts'
import type { CharacterAgentSkillPlaybookId } from '../../characterAgentDefinitions.ts'

const RECENT_IMAGE_RECALL_MS = 8_000
const recentImageRecallByConversation = new Map<string, number>()

export const scheduleMemoryImageRecallFromUserTurn = async (input: {
  conversationId: string
  userText: string
}): Promise<void> => {
  const result = await recallConversationImage({
    conversationId: input.conversationId,
    queryText: input.userText,
    source: 'runtime',
  })
  if (result) {
    recentImageRecallByConversation.set(input.conversationId, Date.now())
  }
}

export const executeRoutedSkill = async (input: {
  conversationId: string
  decision: { skillId: CharacterAgentSkillPlaybookId; reason: string }
  assistantText: string
  lastUserText: string
  eventType?: string
}): Promise<void> => {
  if (input.decision.skillId === 'visual-expression') {
    await maybeGenerateSceneImageFromAssistantMessage({
      conversationId: input.conversationId,
      assistantText: input.assistantText,
      eventType: input.eventType,
    })
    return
  }

  if (input.decision.skillId === 'run-quiz') {
    await runConversationQuizSkill({
      conversationId: input.conversationId,
      source: 'runtime',
      userText: input.lastUserText,
      assistantText: input.assistantText,
    })
    return
  }

  if (input.decision.reason === 'memory-image-request' && input.decision.skillId === 'guided-explanation') {
    const lastRecall = recentImageRecallByConversation.get(input.conversationId)
    if (typeof lastRecall === 'number' && Date.now() - lastRecall < RECENT_IMAGE_RECALL_MS) {
      return
    }
    await recallConversationImage({
      conversationId: input.conversationId,
      queryText: input.lastUserText,
      source: 'runtime',
    })
    recentImageRecallByConversation.set(input.conversationId, Date.now())
  }
}
