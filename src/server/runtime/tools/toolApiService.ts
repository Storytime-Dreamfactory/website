import { runConversationQuizSkill } from '../../conversationQuizToolService.ts'
import { recallConversationImage } from '../../conversationImageMemoryToolService.ts'
import { generateConversationHeroToolApi as generateConversationHeroToolApiService } from '../../conversationImageToolService.ts'

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

export const showImageToolApi = async (input: {
  conversationId: string
  queryText?: string
}) =>
  recallConversationImage({
    conversationId: input.conversationId,
    queryText: input.queryText,
    source: 'api',
  })

export const generateConversationHeroToolApi = async (input: {
  conversationId: string
  characterId: string
  scenePrompt: string
  styleHint?: string
  interactionTargets?: unknown
  relatedCharacterIds?: unknown
  relatedCharacterNames?: unknown
  forceReferenceImagePaths?: unknown
  width?: unknown
  height?: unknown
  pollIntervalMs?: unknown
  maxPollAttempts?: unknown
  seed?: unknown
}) => generateConversationHeroToolApiService(input)
