import { trackTraceActivitySafely } from '../../traceActivity.ts'
import { recallConversationImage } from '../../conversationImageMemoryToolService.ts'
import { runConversationQuizSkill } from '../../conversationQuizToolService.ts'
import { createActivity } from '../../activityStore.ts'
import { generateConversationHeroToolApi } from '../tools/toolApiService.ts'
import type { RuntimeToolExecutionIntent } from '../router/intentRouter.ts'
import {
  readActivitiesRuntimeTool,
  readConversationHistoryRuntimeTool,
  readRelatedObjectContextsRuntimeTool,
  runCliTaskRuntimeTool,
  showImageRuntimeTool,
} from '../tools/runtimeToolRegistry.ts'

const INTERNAL_SEARCH_RE =
  /(intern|interne events|inklusive intern|alle events|all events|trace|tool-event|tool event)/i
const LOCATION_TARGET_RE =
  /(geh(?:e|en)?|besuch(?:e|en)?|reise)\s+(?:zu|zum|zur|nach)\s*([a-z0-9äöüß-]{3,})/i
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

const SCENE_PROMPT_HEADER_RE = /du\s+erzeugst\s+die\s+naechste\s+szene/i
const SCENE_CORE_RE = /SZENENKERN:\s*([\s\S]*?)(?:\n(?:LETZTE STORY-AKTIVITAETEN:|AUFGABE:)|$)/gi

const compactText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const clampHint = (value: string, max = 260): string =>
  value.length > max ? `${value.slice(0, max - 3)}...` : value

const sanitizeContinuityHint = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''

  const withoutPrefix = trimmed.replace(/^[^:\n]{1,80}zeigt ein neues bild:\s*/i, '')
  if (!SCENE_PROMPT_HEADER_RE.test(withoutPrefix)) {
    return clampHint(compactText(withoutPrefix))
  }

  const matches = [...withoutPrefix.matchAll(SCENE_CORE_RE)]
  if (matches.length > 0) {
    const lastCore = compactText(matches[matches.length - 1]?.[1] ?? '')
    if (lastCore) return clampHint(lastCore)
  }

  const requestMatch = withoutPrefix.match(/AKTUELLER REQUEST \(MUSS SICHTBAR SEIN\):\s*([\s\S]*?)\s*(?:VISUELLE KONTINUITAET AUS DEM LETZTEN BILD:|$)/i)
  if (requestMatch?.[1]) {
    return clampHint(compactText(requestMatch[1]))
  }

  return clampHint(withoutPrefix)
}

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

const extractScenePrompt = (assistantText: string, userText: string): string => {
  const assistant = assistantText.trim()
  const explicit = assistant.match(/ich\s+zeige\s+dir\s+jetzt[:\-]?\s*([\s\S]+)$/i)
  if (explicit?.[1]?.trim()) return explicit[1].trim()
  if (assistant.length > 0) return assistant
  return userText.trim()
}

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const pickLatestConversationImagePath = (input: {
  activities: Array<{
    conversationId?: string
    imageRefs: { imageUrl?: string; heroImageUrl?: string }
  }>
  conversationId: string
}): string | undefined => {
  for (const item of input.activities) {
    if (item.conversationId !== input.conversationId) continue
    const candidate = item.imageRefs.imageUrl ?? item.imageRefs.heroImageUrl
    if (candidate?.trim()) return candidate.trim()
  }
  return undefined
}

const collectStoryImageHints = (input: {
  activities: Array<{
    imageRefs: { imageId?: string; imageUrl?: string; heroImageUrl?: string }
    summary?: string
    metadata?: Record<string, unknown>
  }>
  history: Array<{
    imageCandidates: Array<{ imageId?: string; imageUrl?: string; scenePrompt?: string }>
  }>
}): string[] => {
  const activityHints = input.activities
    .filter(
      (item) =>
        Boolean(item.imageRefs.imageId) ||
        Boolean(item.imageRefs.imageUrl) ||
        Boolean(item.imageRefs.heroImageUrl),
    )
    .map(
      (item) =>
        readText(item.metadata?.scenePrompt) ||
        item.summary?.trim() ||
        item.imageRefs.imageId ||
        item.imageRefs.imageUrl ||
        item.imageRefs.heroImageUrl ||
        '',
    )
    .map((item) => sanitizeContinuityHint(item))
    .filter((item) => item.length > 0)
  const historyHints = input.history
    .flatMap((item) => item.imageCandidates.slice(0, 2))
    .map((item) => item.scenePrompt ?? item.imageId ?? item.imageUrl ?? '')
    .map((item) => sanitizeContinuityHint(item))
    .filter((item) => item.length > 0)
  return Array.from(new Set([...activityHints, ...historyHints])).slice(0, 3)
}

const summarizeRecentActivities = (items: Array<{ summary?: string; activityType: string }>): string =>
  items
    .slice(0, 6)
    .map((item, index) => {
      const label = item.summary?.trim() || item.activityType
      return `${index + 1}. ${label}`
    })
    .join('\n')

const buildDoSomethingScenePrompt = (input: {
  userRequest: string
  assistantText: string
  lastImageHints: string[]
  recentActivitySummaries: string
}): string => {
  const basePrompt = extractScenePrompt(input.assistantText, input.userRequest)
  const lastImageContext =
    input.lastImageHints.length > 0 ? input.lastImageHints.join(' | ') : 'Kein vorheriges Bild gefunden.'
  const activityContext = input.recentActivitySummaries || 'Keine relevanten Activities vorhanden.'
  return [
    'Du erzeugst die NAECHSTE Szene einer fortlaufenden Kinder-Bildergeschichte.',
    '',
    'AKTUELLER REQUEST (MUSS SICHTBAR SEIN):',
    input.userRequest.trim() || basePrompt,
    '',
    'VISUELLE KONTINUITAET AUS DEM LETZTEN BILD:',
    lastImageContext,
    '',
    'LETZTE STORY-AKTIVITAETEN (neu -> alt):',
    activityContext,
    '',
    'AUFGABE:',
    '- Erzeuge die naechste sinnvolle Szene als Fortschritt (kein Reset, kein harter Sprung).',
    '- Uebernimm wiedererkennbare Elemente aus dem letzten Bild, ausser der Request fordert bewusst einen Wechsel.',
    '- Bei Ortswechsel: zeige eine Uebergangs- oder Ankunftsszene.',
    '- Kindgerechter Storytime-Stil, klare Formen, keine Schrift, keine Logos.',
    '',
    'SZENENKERN:',
    basePrompt,
  ]
    .filter((line) => line.length > 0)
    .join('\n')
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

const buildSceneActivitySummary = (assistantText: string, userText: string): string => {
  const base = extractScenePrompt(assistantText, userText).replace(/\s+/g, ' ').trim()
  const fallback = userText.replace(/\s+/g, ' ').trim()
  const value = base || fallback || 'Neue Szene erzeugt'
  return value.length > 140 ? `${value.slice(0, 137)}...` : value
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

    if (input.decision.skillId === 'do-something') {
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
      const recentConversationIds = Array.from(
        new Set(
          recentActivities.items
            .map((item) => item.conversationId)
            .filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
        ),
      )
      if (!recentConversationIds.includes(input.conversationId)) {
        recentConversationIds.unshift(input.conversationId)
      }
      const history = await readConversationHistoryRuntimeTool().execute(toolContext, {
        scope: 'all',
        conversationIds: recentConversationIds,
        limit: 200,
        offset: 0,
        fetchAll: true,
      })
      executedTools.push('read_conversation_history')

      let relatedCharacterIds: string[] = []
      let relatedCharacterNames: string[] = []
      let forceReferenceImagePaths: string[] = []
      const latestConversationImagePath = pickLatestConversationImagePath({
        activities: recentActivities.items,
        conversationId: input.conversationId,
      })
      if (latestConversationImagePath) {
        forceReferenceImagePaths.push(latestConversationImagePath)
      }
      const locationMatch = input.lastUserText.match(LOCATION_TARGET_RE)
      const locationToken = locationMatch?.[2]?.trim().toLowerCase()
      if (locationToken) {
        try {
          const contextResult = await readRelatedObjectContextsRuntimeTool().execute(toolContext, {
            objectType: 'place',
            objectId: locationToken.replace(/\s+/g, '-'),
          })
          relatedCharacterIds = Array.from(
            new Set(contextResult.relatedCharacterIds.map((item) => item.trim()).filter(Boolean)),
          ).slice(0, 8)
          relatedCharacterNames = contextResult.relatedObjects
            .filter((item) => relatedCharacterIds.includes(item.objectId))
            .map((item) => item.displayName.trim())
            .filter(Boolean)
          forceReferenceImagePaths = Array.from(
            new Set([
              ...forceReferenceImagePaths,
              ...contextResult.relatedObjects.flatMap((item) =>
                item.imageRefs
                  .filter((imageRef) => imageRef.kind === 'standard')
                  .map((imageRef) => imageRef.path.trim())
                  .filter(Boolean),
              ),
            ]),
          ).slice(0, 8)
          executedTools.push('read_related_object_contexts')
        } catch {
          // Best effort: action flow continues even if object context is missing.
        }
      }

      const storyHints = collectStoryImageHints({
        activities: recentActivities.items,
        history: history.conversations,
      })
      const recentActivitySummaries = summarizeRecentActivities(recentActivities.items)
      const scenePrompt = buildDoSomethingScenePrompt({
        userRequest: input.lastUserText,
        assistantText: input.assistantText,
        lastImageHints: storyHints,
        recentActivitySummaries,
      })
      const generatedImage = await generateConversationHeroToolApi({
        conversationId: input.conversationId,
        characterId: input.characterId,
        scenePrompt,
        relatedCharacterIds,
        relatedCharacterNames,
        forceReferenceImagePaths,
      })
      executedTools.push('generate_image')

      const imageUrl =
        typeof generatedImage?.imageUrl === 'string'
          ? generatedImage.imageUrl
          : typeof generatedImage?.heroImageUrl === 'string'
            ? generatedImage.heroImageUrl
            : undefined
      const imageId =
        (typeof generatedImage?.requestId === 'string' ? generatedImage.requestId : undefined) ??
        extractImageIdFromUrl(imageUrl)
      const sceneSummary = buildSceneActivitySummary(input.assistantText, input.lastUserText)
      await createActivity({
        activityType: 'conversation.scene.directed',
        isPublic: true,
        characterId: input.characterId,
        conversationId: input.conversationId,
        learningGoalIds: input.learningGoalIds,
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
          summary: sceneSummary,
          skillId: input.decision.skillId,
          reason: input.decision.reason,
          scenePrompt,
          sourceEventType: input.eventType,
        },
      })
      executedTools.push('record_scene_activity')
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
