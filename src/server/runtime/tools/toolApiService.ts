import { runConversationQuizSkill } from '../../conversationQuizToolService.ts'
import { recallConversationImage } from '../../conversationImageMemoryToolService.ts'

export const runLearningGoalQuizToolApi = async (input: {
  conversationId: string
  learningGoalId?: string
  userText?: string
  assistantText?: string
}) =>
  runConversationQuizSkill({
    conversationId: input.conversationId,
    requestedLearningGoalId: input.learningGoalId,
    userText: input.userText,
    assistantText: input.assistantText,
    source: 'api',
  })

export const displayExistingImageToolApi = async (input: {
  conversationId: string
  queryText?: string
}) =>
  recallConversationImage({
    conversationId: input.conversationId,
    queryText: input.queryText,
    source: 'api',
  })
