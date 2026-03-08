import { appendConversationMessage, getConversationDetails } from './conversationStore.ts'
import { createActivity, listActivities } from './activityStore.ts'
import {
  CHARACTER_AGENT_TOOLS,
  getCharacterAgentSkillPlaybook,
} from './characterAgentDefinitions.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'
import {
  loadCharacterRuntimeProfile,
  loadLearningGoalRuntimeProfile,
  loadLearningGoalRuntimeProfiles,
} from './runtimeContentStore.ts'
import { trackTraceActivitySafely } from './traceActivity.ts'

type RunConversationQuizSkillInput = {
  conversationId: string
  requestedLearningGoalId?: string
  source: 'runtime' | 'api'
  userText?: string
  assistantText?: string
}

export type ConversationQuizResult = {
  characterId: string
  characterName: string
  learningGoalId: string
  learningGoalName: string
  question: string
  questionIndex: number
  totalQuestions: number
}

const QUIZ_SKILL = getCharacterAgentSkillPlaybook('run-quiz')
const QUIZ_COOLDOWN_MS = 15_000
const lastQuizByConversation = new Map<string, number>()

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const trackQuizActivitySafely = async (input: {
  activityType: string
  isPublic?: boolean
  characterId: string
  characterName: string
  conversationId: string
  learningGoalIds?: string[]
  subject?: Record<string, unknown>
  object?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): Promise<void> => {
  try {
    await createActivity({
      activityType: input.activityType,
      isPublic: input.isPublic,
      characterId: input.characterId,
      conversationId: input.conversationId,
      learningGoalIds: input.learningGoalIds,
      subject:
        input.subject ?? {
          type: 'character',
          id: input.characterId,
          name: input.characterName,
        },
      object: input.object,
      metadata: input.metadata,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Quiz activity tracking failed: ${message}`)
  }
}

const isQuizOnCooldown = (conversationId: string): boolean => {
  const last = lastQuizByConversation.get(conversationId)
  return typeof last === 'number' && Date.now() - last < QUIZ_COOLDOWN_MS
}

const markQuizAttempt = (conversationId: string): void => {
  lastQuizByConversation.set(conversationId, Date.now())
}

const selectLearningGoalId = async (input: {
  characterId: string
  activeLearningGoalIds: string[]
  requestedLearningGoalId?: string
}): Promise<string | null> => {
  const requestedLearningGoalId = input.requestedLearningGoalId?.trim()
  if (requestedLearningGoalId) {
    return requestedLearningGoalId
  }

  const characterProfile = await loadCharacterRuntimeProfile(input.characterId)
  const suitableIds = new Set(characterProfile?.suitableLearningGoalIds ?? [])
  const activeIds = input.activeLearningGoalIds.filter((item) => item.trim().length > 0)
  const suitableActiveId = activeIds.find((item) => suitableIds.size === 0 || suitableIds.has(item))
  return suitableActiveId ?? activeIds[0] ?? null
}

const readAskedQuestions = (activities: Awaited<ReturnType<typeof listActivities>>): Set<string> => {
  const askedQuestions = new Set<string>()
  for (const activity of activities) {
    const metadataQuestion = readText(activity.metadata.question)
    if (metadataQuestion) {
      askedQuestions.add(metadataQuestion.toLowerCase())
    }
  }
  return askedQuestions
}

const chooseQuestion = (questions: string[], askedQuestions: Set<string>): { question: string; index: number } => {
  const normalizedQuestions = questions.map((item) => item.trim()).filter((item) => item.length > 0)
  const unaskedQuestionIndex = normalizedQuestions.findIndex(
    (item) => !askedQuestions.has(item.toLowerCase()),
  )
  if (unaskedQuestionIndex >= 0) {
    return { question: normalizedQuestions[unaskedQuestionIndex], index: unaskedQuestionIndex }
  }
  return { question: normalizedQuestions[0] ?? '', index: 0 }
}

export const runConversationQuizSkill = async (
  input: RunConversationQuizSkillInput,
): Promise<ConversationQuizResult | null> => {
  const conversationId = input.conversationId.trim()
  if (!conversationId) return null
  await trackTraceActivitySafely({
    activityType: 'trace.skill.run_quiz.request',
    summary: 'run-quiz gestartet',
    conversationId,
    traceStage: 'skill',
    traceKind: 'request',
    traceSource: input.source === 'api' ? 'api' : 'runtime',
    input: {
      requestedLearningGoalId: input.requestedLearningGoalId,
      userText: input.userText?.slice(0, 240),
      assistantText: input.assistantText?.slice(0, 240),
    },
  })
  if (input.source === 'runtime' && isQuizOnCooldown(conversationId)) return null

  const details = await getConversationDetails(conversationId)
  const runtimeContext = contextFromMetadata(details.conversation.metadata)
  const characterId = details.conversation.characterId
  const characterProfile = await loadCharacterRuntimeProfile(characterId)
  const characterName = characterProfile?.name ?? characterId
  const activeLearningGoals = await loadLearningGoalRuntimeProfiles(runtimeContext.learningGoalIds ?? [])
  const selectedLearningGoalId = await selectLearningGoalId({
    characterId,
    activeLearningGoalIds: activeLearningGoals.map((item) => item.id),
    requestedLearningGoalId: input.requestedLearningGoalId,
  })
  if (!selectedLearningGoalId) return null

  const learningGoal =
    activeLearningGoals.find((item) => item.id === selectedLearningGoalId) ??
    (await loadLearningGoalRuntimeProfile(selectedLearningGoalId))
  if (!learningGoal || learningGoal.exampleQuestions.length === 0) {
    return null
  }

  markQuizAttempt(conversationId)
  const previousQuizActivities = await listActivities({
    conversationId,
    activityType: 'skill.quiz.completed',
    limit: 24,
  })
  await trackQuizActivitySafely({
    activityType: 'tool.activities.read',
    isPublic: false,
    characterId,
    characterName,
    conversationId,
    learningGoalIds: [learningGoal.id],
    object: {
      type: 'activities',
      scope: 'conversation.quiz.history',
    },
    metadata: {
      summary: `${characterName} schaut in bisherige Quizmomente`,
      skillId: QUIZ_SKILL?.id,
      toolId: CHARACTER_AGENT_TOOLS.readActivities,
      activityCount: previousQuizActivities.length,
      learningGoalId: learningGoal.id,
      learningGoalName: learningGoal.name,
      source: input.source,
    },
  })

  const askedQuestions = readAskedQuestions(previousQuizActivities)
  const selectedQuestion = chooseQuestion(learningGoal.exampleQuestions, askedQuestions)
  if (!selectedQuestion.question) return null

  await trackQuizActivitySafely({
    activityType: 'skill.quiz.started',
    isPublic: false,
    characterId,
    characterName,
    conversationId,
    learningGoalIds: [learningGoal.id],
    object: {
      type: 'learning_goal',
      id: learningGoal.id,
      name: learningGoal.name,
    },
    metadata: {
      summary: `${characterName} startet ein Quiz zu ${learningGoal.name}`,
      skillId: QUIZ_SKILL?.id,
      toolIds: QUIZ_SKILL?.toolIds ?? [],
      learningGoalId: learningGoal.id,
      learningGoalName: learningGoal.name,
      source: input.source,
      userText: input.userText?.trim() || undefined,
      assistantText: input.assistantText?.trim() || undefined,
    },
  })

  const promptSummary = `${characterName} fragt im Quiz: ${selectedQuestion.question}`
  await appendConversationMessage({
    conversationId,
    role: 'system',
    content: promptSummary,
    eventType: 'skill.quiz.prompt.generated',
    metadata: {
      skillId: QUIZ_SKILL?.id,
      toolIds: QUIZ_SKILL?.toolIds ?? [],
      learningGoalId: learningGoal.id,
      learningGoalName: learningGoal.name,
      learningGoalTopic: learningGoal.topic || undefined,
      question: selectedQuestion.question,
      questionIndex: selectedQuestion.index + 1,
      totalQuestions: learningGoal.exampleQuestions.length,
      practiceIdeas: learningGoal.practiceIdeas,
      source: input.source,
    },
  })

  await trackQuizActivitySafely({
    activityType: 'skill.quiz.completed',
    isPublic: false,
    characterId,
    characterName,
    conversationId,
    learningGoalIds: [learningGoal.id],
    object: {
      type: 'quiz_question',
      text: selectedQuestion.question,
      index: selectedQuestion.index + 1,
    },
    metadata: {
      summary: promptSummary,
      skillId: QUIZ_SKILL?.id,
      toolIds: QUIZ_SKILL?.toolIds ?? [],
      learningGoalId: learningGoal.id,
      learningGoalName: learningGoal.name,
      question: selectedQuestion.question,
      questionIndex: selectedQuestion.index + 1,
      totalQuestions: learningGoal.exampleQuestions.length,
      source: input.source,
    },
  })

  const result = {
    characterId,
    characterName,
    learningGoalId: learningGoal.id,
    learningGoalName: learningGoal.name,
    question: selectedQuestion.question,
    questionIndex: selectedQuestion.index + 1,
    totalQuestions: learningGoal.exampleQuestions.length,
  }
  await trackTraceActivitySafely({
    activityType: 'trace.skill.run_quiz.response',
    summary: 'run-quiz abgeschlossen',
    conversationId,
    characterId,
    characterName,
    learningGoalIds: [learningGoal.id],
    traceStage: 'skill',
    traceKind: 'response',
    traceSource: input.source === 'api' ? 'api' : 'runtime',
    output: {
      learningGoalId: learningGoal.id,
      questionIndex: result.questionIndex,
      totalQuestions: result.totalQuestions,
    },
    ok: true,
  })
  return result
}
