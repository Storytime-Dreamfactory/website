import { trackTraceActivitySafely } from '../../traceActivity.ts'
import { recallConversationImage } from '../../conversationImageMemoryToolService.ts'
import { runConversationQuizSkill } from '../../conversationQuizToolService.ts'
import { maybeGenerateSceneImageFromAssistantMessage } from '../../conversationSceneImageService.ts'
import type { RuntimeToolExecutionIntent } from '../router/intentRouter.ts'
import {
  readActivitiesRuntimeTool,
  readConversationHistoryRuntimeTool,
  runCliTaskRuntimeTool,
  showImageRuntimeTool,
} from '../tools/runtimeToolRegistry.ts'

const VISUAL_MARKER_RE = /ich\s+zeige\s+dir\s+jetzt|schau\s+mal/i
const INTERNAL_SEARCH_RE =
  /(intern|interne events|inklusive intern|alle events|all events|trace|tool-event|tool event)/i
const QUERY_STOPWORDS = new Set([
  'bitte',
  'zeige',
  'zeigen',
  'bild',
  'erinnerung',
  'erinnerungen',
  'conversation',
  'unterhaltung',
  'damals',
  'wir',
  'unsere',
])

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 2 && !QUERY_STOPWORDS.has(item))

const shouldRunQuiz = (input: {
  skillId: string
  reason: string
  assistantText: string
  lastUserText: string
}): boolean => {
  if (input.skillId !== 'do-something') return false
  if (/quiz/i.test(input.reason)) return true
  if (/quiz/i.test(input.lastUserText)) return true
  return /frage/i.test(input.assistantText) && /quiz/i.test(input.assistantText)
}

const pickBestImageCandidate = (input: {
  queryText: string
  activities: Array<{
    imageRefs: { imageId?: string; imageUrl?: string; heroImageUrl?: string }
    summary?: string
  }>
  history: Array<{
    imageCandidates: Array<{ imageId?: string; imageUrl?: string; scenePrompt?: string }>
  }>
}): { hint?: string; preferredImageUrl?: string; preferredImageId?: string; matched: boolean } => {
  const tokens = tokenize(input.queryText)
  const candidates: Array<{
    text: string
    hint: string
    imageUrl?: string
    imageId?: string
  }> = []

  for (const convo of input.history) {
    for (const image of convo.imageCandidates) {
      const text = `${image.scenePrompt ?? ''} ${image.imageId ?? ''} ${image.imageUrl ?? ''}`.toLowerCase()
      const hint = image.scenePrompt ?? image.imageId ?? image.imageUrl ?? ''
      if (hint) {
        candidates.push({
          text,
          hint,
          imageUrl: image.imageUrl,
          imageId: image.imageId,
        })
      }
    }
  }
  for (const activity of input.activities) {
    const imageHint =
      activity.imageRefs.imageId ?? activity.imageRefs.imageUrl ?? activity.imageRefs.heroImageUrl
    if (!imageHint) continue
    const text = `${activity.summary ?? ''} ${imageHint}`.toLowerCase()
    candidates.push({
      text,
      hint: imageHint,
      imageUrl: activity.imageRefs.imageUrl ?? activity.imageRefs.heroImageUrl,
      imageId: activity.imageRefs.imageId,
    })
  }
  if (candidates.length === 0) return { matched: false }
  if (tokens.length === 0) {
    return {
      hint: candidates[0].hint,
      preferredImageUrl: candidates[0].imageUrl,
      preferredImageId: candidates[0].imageId,
      matched: false,
    }
  }

  let best: { hint: string; score: number; imageUrl?: string; imageId?: string } | null = null
  for (const candidate of candidates) {
    let score = 0
    for (const token of tokens) {
      if (candidate.text.includes(token)) score += 1
    }
    if (!best || score > best.score) {
      best = {
        hint: candidate.hint,
        score,
        imageUrl: candidate.imageUrl,
        imageId: candidate.imageId,
      }
    }
  }
  if (!best) {
    return {
      hint: candidates[0].hint,
      preferredImageUrl: candidates[0].imageUrl,
      preferredImageId: candidates[0].imageId,
      matched: false,
    }
  }
  return {
    hint: best.hint,
    preferredImageUrl: best.imageUrl,
    preferredImageId: best.imageId,
    matched: best.score > 0,
  }
}

export const scheduleMemoryImageRecallFromUserTurn = async (input: {
  conversationId: string
  userText: string
}): Promise<void> => {
  await recallConversationImage({
    conversationId: input.conversationId,
    queryText: input.userText,
    source: 'runtime',
  })
}

export const executeRoutedSkill = async (input: {
  conversationId: string
  decision: { skillId: string; reason: string }
  assistantText: string
  lastUserText: string
  eventType?: string
  characterId: string
  characterName: string
  learningGoalIds?: string[]
  toolExecutionIntent?: RuntimeToolExecutionIntent | null
}): Promise<void> => {
  await trackTraceActivitySafely({
    activityType: 'trace.skill.execution.request',
    summary: `Skill-Ausfuehrung gestartet (${input.decision.skillId})`,
    conversationId: input.conversationId,
    characterId: input.characterId,
    characterName: input.characterName,
    learningGoalIds: input.learningGoalIds,
    traceStage: 'skill',
    traceKind: 'request',
    traceSource: 'runtime',
    input: {
      skillId: input.decision.skillId,
      reason: input.decision.reason,
      lastUserText: input.lastUserText.slice(0, 240),
    },
  })
  const executedTools: string[] = []
  let toolExecutionError: string | null = null

  try {
    if (input.decision.skillId === 'remember-something') {
      const scope: 'external' | 'all' = INTERNAL_SEARCH_RE.test(input.lastUserText)
        ? 'all'
        : 'external'
      const toolContext = {
        characterId: input.characterId,
        characterName: input.characterName,
        conversationId: input.conversationId,
        learningGoalIds: input.learningGoalIds,
      }
      const activityResult = await readActivitiesRuntimeTool().execute(toolContext, {
        scope,
        limit: 200,
        offset: 0,
      })
      executedTools.push('read_activities')
      const conversationIds = Array.from(
        new Set(
          activityResult.items
            .map((item) => item.conversationId)
            .filter((item): item is string => typeof item === 'string' && item.length > 0),
        ),
      )
      if (!conversationIds.includes(input.conversationId)) {
        conversationIds.unshift(input.conversationId)
      }
      const historyResult = await readConversationHistoryRuntimeTool().execute(toolContext, {
        scope,
        conversationIds,
        limit: 200,
        offset: 0,
      })
      executedTools.push('read_conversation_history')
      const candidate = pickBestImageCandidate({
        queryText: input.lastUserText,
        activities: activityResult.items,
        history: historyResult.conversations,
      })
      const queryText =
        candidate.hint && candidate.hint.length > 0
          ? `${input.lastUserText}\nBevorzugter Kontext: ${candidate.hint}`
          : input.lastUserText
      await showImageRuntimeTool().execute(toolContext, {
        queryText,
        preferredImageUrl: candidate.preferredImageUrl,
        preferredImageId: candidate.preferredImageId,
        source: 'runtime',
      })
      executedTools.push('show_image')
    }

    if (input.decision.skillId === 'do-something' && VISUAL_MARKER_RE.test(input.assistantText)) {
      await maybeGenerateSceneImageFromAssistantMessage({
        conversationId: input.conversationId,
        assistantText: input.assistantText,
        eventType: input.eventType,
      })
      executedTools.push('generate_image')
    }

    if (
      shouldRunQuiz({
        skillId: input.decision.skillId,
        reason: input.decision.reason,
        assistantText: input.assistantText,
        lastUserText: input.lastUserText,
      })
    ) {
      await runConversationQuizSkill({
        conversationId: input.conversationId,
        userText: input.lastUserText,
        assistantText: input.assistantText,
        source: 'runtime',
      })
      executedTools.push('run_quiz')
    }

    if (input.toolExecutionIntent) {
      await runCliTaskRuntimeTool().execute(
        {
          characterId: input.characterId,
          characterName: input.characterName,
          conversationId: input.conversationId,
          learningGoalIds: input.learningGoalIds,
        },
        {
          taskId: input.toolExecutionIntent.taskId,
          args: input.toolExecutionIntent.args,
          dryRun: input.toolExecutionIntent.dryRun,
        },
      )
      executedTools.push('run_cli_task')
    }
  } catch (error) {
    toolExecutionError = error instanceof Error ? error.message : String(error)
  }

  await trackTraceActivitySafely({
    activityType: 'trace.skill.execution.response',
    summary: `Skill-Ausfuehrung ${input.decision.skillId} abgeschlossen`,
    conversationId: input.conversationId,
    characterId: input.characterId,
    characterName: input.characterName,
    learningGoalIds: input.learningGoalIds,
    traceStage: 'skill',
    traceKind: 'response',
    traceSource: 'runtime',
    output: {
      skillId: input.decision.skillId,
      reason: input.decision.reason,
      hasToolExecutionIntent: Boolean(input.toolExecutionIntent),
      toolExecutionTaskId: input.toolExecutionIntent?.taskId,
      executedTools,
      sourceEventType: input.eventType,
    },
    ok: toolExecutionError == null,
    error: toolExecutionError ?? undefined,
  })
}
