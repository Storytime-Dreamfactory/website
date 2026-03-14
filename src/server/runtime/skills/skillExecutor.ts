import { trackTraceActivitySafely } from '../../traceActivity.ts'
import { recallConversationImage } from '../../conversationImageMemoryToolService.ts'
import { runConversationQuizSkill } from '../../conversationQuizToolService.ts'
import { createActivity } from '../../activityStore.ts'
import { appendConversationMessage } from '../../conversationStore.ts'
import { RUNTIME_TEMPORARY_UNAVAILABLE_MESSAGE, readServerEnv } from '../../openAiConfig.ts'
import { loadLearningGoalRuntimeProfiles } from '../../runtimeContentStore.ts'
import { resolveCharacterImageRefs } from '../context/contextCollationService.ts'
import { generateConversationHeroToolApi } from '../tools/toolApiService.ts'
import {
  readActivitiesRuntimeTool,
  readConversationHistoryRuntimeTool,
  showImageRuntimeTool,
} from '../tools/runtimeToolRegistry.ts'
import {
  buildPublicActivityStream,
  buildStoryHistoryContext,
  generateSceneSummaryAndImagePrompt,
  selectGroundedSceneCharacters,
  type SceneCharacterContext,
  type SceneLearningGoalContext,
  type SceneRelationshipContext,
} from './createSceneBuilder.ts'

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
const STORYBOOK_ACTIVITY_TYPES = new Set(['conversation.image.generated', 'conversation.image.recalled'])
const TRACE_PREVIEW_MAX_LENGTH = 240

const previewText = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length > TRACE_PREVIEW_MAX_LENGTH
    ? `${trimmed.slice(0, TRACE_PREVIEW_MAX_LENGTH)}...`
    : trimmed
}

const resolveSceneBuildModel = (): string => {
  const nextSceneModel = readServerEnv('RUNTIME_NEXT_SCENE_SUMMARY_MODEL', 'gpt-5.4')
  return readServerEnv('RUNTIME_IMAGE_PROMPT_MODEL', nextSceneModel)
}

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 2 && !QUERY_STOPWORDS.has(item))

const SIMPLE_REUSE_HINTS = [
  'nochmal',
  'noch mal',
  'wieder',
  'von eben',
  'gerade eben',
  'das gleiche',
  'dieselbe',
  'selbe bild',
  'gleiches bild',
  'unser bild',
  'letzte bild',
  'vorige bild',
] as const

const isExplicitImageReuseRequest = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return false
  if (!normalized.includes('bild')) return false
  return SIMPLE_REUSE_HINTS.some((hint) => normalized.includes(hint))
}


const shouldRunQuiz = (input: {
  skillId: string
  reason: string
  assistantText: string
  lastUserText: string
}): boolean => {
  if (input.skillId !== 'create_scene') return false
  if (/quiz/i.test(input.reason)) return true
  if (/quiz/i.test(input.lastUserText)) return true
  return /frage/i.test(input.assistantText) && /quiz/i.test(input.assistantText)
}

const extractImageIdFromUrl = (value: string | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  const base = normalized.split('?')[0] ?? normalized
  const segment = base.split('/').filter((part) => part.length > 0).pop()
  if (!segment) return undefined
  const dotIndex = segment.lastIndexOf('.')
  return dotIndex > 0 ? segment.slice(0, dotIndex) : segment
}

const pickBestImageCandidate = (input: {
  queryText: string
  activities: Array<{
    imageRefs: { imageId?: string; imageUrl?: string; heroImageUrl?: string }
    summary?: string
  }>
  history: Array<{
    imageCandidates: Array<{ imageId?: string; imageUrl?: string; summary?: string; imagePrompt?: string }>
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
      const text = `${image.summary ?? ''} ${image.imagePrompt ?? ''} ${image.imageId ?? ''} ${image.imageUrl ?? ''}`.toLowerCase()
      const hint = image.summary ?? image.imageId ?? image.imageUrl ?? ''
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
  characterContext?: SceneCharacterContext
  learningGoalIds?: string[]
  relationshipContext?: SceneRelationshipContext | null
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
        fetchAll: true,
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
        fetchAll: true,
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

    if (input.decision.skillId === 'create_scene') {
      const toolContext = {
        characterId: input.characterId,
        characterName: input.characterName,
        conversationId: input.conversationId,
        learningGoalIds: input.learningGoalIds,
      }
      const recentActivities = await readActivitiesRuntimeTool().execute(toolContext, {
        scope: 'external',
        limit: 200,
        offset: 0,
        fetchAll: true,
      })
      executedTools.push('read_activities')

      const publicActivityStream = buildPublicActivityStream(recentActivities.items)
      const storyActivities = recentActivities.items.filter((activity) =>
        STORYBOOK_ACTIVITY_TYPES.has(activity.activityType),
      )
      const storyHistory = buildStoryHistoryContext(storyActivities)
      const learningGoalProfiles = await loadLearningGoalRuntimeProfiles(input.learningGoalIds ?? [])
      const learningGoalContexts: SceneLearningGoalContext[] = learningGoalProfiles.map((goal) => ({
        id: goal.id,
        name: goal.name,
        topicGroup: goal.topicGroup,
        topic: goal.topic,
        sessionGoal: goal.sessionGoal,
        endState: goal.endState,
        coreIdeas: goal.coreIdeas,
        assessmentTargets: goal.assessmentTargets,
      }))
      const mainCharacterImageRefs = await resolveCharacterImageRefs(input.characterId)
      const directRelatedObjects = input.relationshipContext?.directRelatedObjects ?? []
      const contextualRelatedObjects = input.relationshipContext?.contextualRelatedObjects ?? []
      const provisionalGroundedSceneCharacters = selectGroundedSceneCharacters({
        mainCharacterId: input.characterId,
        mainCharacterName: input.characterName,
        mainCharacterImageRefs,
        userRequest: input.lastUserText,
        nextSceneSummary: input.assistantText || input.lastUserText,
        directRelatedObjects,
        contextualRelatedObjects,
      })
      const sceneBuildModel = resolveSceneBuildModel()
      await trackTraceActivitySafely({
        activityType: 'trace.tool.scene_build.request',
        summary: 'scene_build gestartet',
        conversationId: input.conversationId,
        characterId: input.characterId,
        characterName: input.characterName,
        learningGoalIds: input.learningGoalIds,
        traceStage: 'tool',
        traceKind: 'request',
        traceSource: 'runtime',
        input: {
          model: sceneBuildModel,
          userRequestPreview: previewText(input.lastUserText),
          assistantTextPreview: previewText(input.assistantText),
        },
      })
      let sceneBuild: Awaited<ReturnType<typeof generateSceneSummaryAndImagePrompt>>
      try {
        sceneBuild = await generateSceneSummaryAndImagePrompt({
          characterName: input.characterName,
          characterContext: input.characterContext,
          learningGoalContexts,
          userRequest: input.lastUserText,
          assistantText: input.assistantText,
          history: storyHistory,
          publicActivityStream,
          groundedSceneCharacters: provisionalGroundedSceneCharacters,
        })
        await trackTraceActivitySafely({
          activityType: 'trace.tool.scene_build.response',
          summary: 'scene_build abgeschlossen',
          conversationId: input.conversationId,
          characterId: input.characterId,
          characterName: input.characterName,
          learningGoalIds: input.learningGoalIds,
          traceStage: 'tool',
          traceKind: 'response',
          traceSource: 'runtime',
          output: {
            ok: true,
            model: sceneBuildModel,
            sceneSummaryPreview: previewText(sceneBuild.sceneSummary),
            imagePromptPreview: previewText(sceneBuild.imagePrompt),
          },
          ok: true,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await trackTraceActivitySafely({
          activityType: 'trace.tool.scene_build.error',
          summary: 'scene_build fehlgeschlagen',
          conversationId: input.conversationId,
          characterId: input.characterId,
          characterName: input.characterName,
          learningGoalIds: input.learningGoalIds,
          traceStage: 'tool',
          traceKind: 'error',
          traceSource: 'runtime',
          ok: false,
          error: message,
          output: {
            ok: false,
            model: sceneBuildModel,
          },
        })
        throw error
      }
      const nextSceneSummary = sceneBuild.sceneSummary
      const groundedSceneCharacters = selectGroundedSceneCharacters({
        mainCharacterId: input.characterId,
        mainCharacterName: input.characterName,
        mainCharacterImageRefs,
        userRequest: input.lastUserText,
        nextSceneSummary,
        directRelatedObjects,
        contextualRelatedObjects,
      })
      const forceReferenceImagePaths = [
        ...Array.from(
          new Set(
            [storyHistory.previousScene?.imageUrl, storyHistory.latestScene?.imageUrl].filter(
              (item): item is string => typeof item === 'string' && item.trim().length > 0,
            ),
          ),
        ).slice(0, 2),
        ...Array.from(
          new Set(
            groundedSceneCharacters
              .filter(
                (character) =>
                  character.source !== 'active-character' &&
                  typeof character.standardImagePath === 'string' &&
                  character.standardImagePath.trim().length > 0,
              )
              .map((character) => character.standardImagePath as string),
          ),
        ).slice(0, 4),
      ]
      const imagePrompt = sceneBuild.imagePrompt
      const relatedSceneCharacters = groundedSceneCharacters.filter(
        (character) => character.source !== 'active-character',
      )
      const prefersImageReuse = isExplicitImageReuseRequest(input.lastUserText)
      let generatedImage:
        | Awaited<ReturnType<typeof generateConversationHeroToolApi>>
        | null = null
      let imageSelectionMode: 'reused' | 'generated' = 'generated'

      if (prefersImageReuse) {
        const recalledImage = await recallConversationImage({
          conversationId: input.conversationId,
          queryText: input.lastUserText,
          source: 'runtime',
        })
        if (recalledImage) {
          imageSelectionMode = 'reused'
          executedTools.push('show_image')
        }
      }

      if (imageSelectionMode === 'generated') {
        generatedImage = await generateConversationHeroToolApi({
          conversationId: input.conversationId,
          characterId: input.characterId,
          sceneSummary: nextSceneSummary,
          imagePrompt,
          forceReferenceImagePaths,
          ...(relatedSceneCharacters.length > 0
            ? {
                relatedCharacterIds: relatedSceneCharacters.map((character) => character.characterId),
                relatedCharacterNames: relatedSceneCharacters.map((character) => character.displayName),
              }
            : {}),
        })
        executedTools.push('generate_image')
      }

      await trackTraceActivitySafely({
        activityType: 'trace.runtime.scene_image_strategy',
        summary:
          imageSelectionMode === 'reused'
            ? 'Bestehendes Bild wurde wiederverwendet'
            : 'Neues Bild wurde generiert',
        conversationId: input.conversationId,
        characterId: input.characterId,
        characterName: input.characterName,
        learningGoalIds: input.learningGoalIds,
        traceStage: 'egress',
        traceKind: 'response',
        traceSource: 'runtime',
        output: {
          imageSelectionMode,
          reason: prefersImageReuse ? 'simple-reuse-request' : 'default-generate',
        },
        ok: true,
      })

      if (generatedImage) {
        const imageUrl =
          typeof generatedImage.imageUrl === 'string'
            ? generatedImage.imageUrl
            : typeof generatedImage.heroImageUrl === 'string'
              ? generatedImage.heroImageUrl
              : undefined
        const imageId =
          (typeof generatedImage.requestId === 'string' ? generatedImage.requestId : undefined) ??
          extractImageIdFromUrl(imageUrl)
        await createActivity({
          activityType: 'conversation.scene.directed',
          isPublic: false,
          characterId: input.characterId,
          conversationId: input.conversationId,
          learningGoalIds: input.learningGoalIds,
          storySummary: nextSceneSummary,
          subject: {
            type: 'character',
            id: input.characterId,
            name: input.characterName,
          },
          object: {
            type: 'image',
            id: imageId,
            url: imageUrl,
          },
          metadata: {
            summary: nextSceneSummary,
            skillId: input.decision.skillId,
            reason: input.decision.reason,
            nextSceneSummary,
            imagePrompt,
            publicActivityStream,
            storyHistory,
            groundedSceneCharacters,
            sourceEventType: input.eventType,
          },
        })
        executedTools.push('record_scene_activity')
      }
    }

    if (input.decision.skillId === 'evaluate-feedback') {
      await createActivity({
        activityType: 'eval.feedback.submitted',
        isPublic: false,
        characterId: input.characterId,
        conversationId: input.conversationId,
        learningGoalIds: input.learningGoalIds,
        subject: {
          type: 'person',
          id: 'user',
        },
        object: {
          type: 'feedback',
          feedbackText: input.lastUserText,
          assistantText: input.assistantText,
        },
        metadata: {
          feedbackText: input.lastUserText,
          assistantContext: input.assistantText.slice(0, 500),
          skillId: input.decision.skillId,
          reason: input.decision.reason,
          sourceEventType: input.eventType,
        },
      })
      executedTools.push('store_eval_feedback')
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

  } catch (error) {
    toolExecutionError = error instanceof Error ? error.message : String(error)
    await appendConversationMessage({
      conversationId: input.conversationId,
      role: 'assistant',
      content: RUNTIME_TEMPORARY_UNAVAILABLE_MESSAGE,
      eventType: 'runtime.skill.unavailable',
      metadata: {
        sourceEventType: input.eventType,
        failedSkillId: input.decision.skillId,
        reason: toolExecutionError,
      },
    }).catch(() => undefined)
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
      executedTools,
      sourceEventType: input.eventType,
    },
    ok: toolExecutionError == null,
    error: toolExecutionError ?? undefined,
  })
}
