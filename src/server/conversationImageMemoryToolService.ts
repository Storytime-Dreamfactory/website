import { createActivity, listActivities } from './activityStore.ts'
import {
  CHARACTER_AGENT_TOOLS,
  getCharacterAgentSkillPlaybook,
} from './characterAgentDefinitions.ts'
import { appendConversationMessage, getConversationDetails } from './conversationStore.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'
import { loadCharacterRuntimeProfile } from './runtimeContentStore.ts'
import { storeConversationImageAsset } from './conversationImageAssetStore.ts'
import {
  buildCharacterInteractionTargets,
  buildInteractionMetadata,
  parseInteractionTargets,
} from './activityInteractionMetadata.ts'
import { resolveCharacterImageRefs } from './runtime/context/contextCollationService.ts'
import { trackTraceActivitySafely } from './traceActivity.ts'
import { getOpenAiApiKey } from './openAiConfig.ts'
import {
  readCanonicalStoryText,
  readImagePromptValue,
  readSceneSummaryValue,
} from '../storyText.ts'

type RecallConversationImageInput = {
  conversationId: string
  queryText?: string
  preferredImageUrl?: string
  preferredImageId?: string
  source: 'runtime' | 'api'
}

export type RecalledConversationImage = {
  imageUrl: string
  sceneSummary?: string
  imagePrompt?: string
  reason: 'latest' | 'query_match'
}

const GUIDED_EXPLANATION_SKILL = getCharacterAgentSkillPlaybook('guided-explanation')

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const readTextList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

const trackImageMemoryActivitySafely = async (input: {
  activityType: string
  isPublic: boolean
  characterId: string
  characterName: string
  conversationId: string
  learningGoalIds?: string[]
  imageUrl: string
  storySummary?: string
  metadata: Record<string, unknown>
}): Promise<void> => {
  try {
    await createActivity({
      activityType: input.activityType,
      isPublic: input.isPublic,
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
        url: input.imageUrl,
      },
      storySummary: input.storySummary,
      metadata: input.metadata,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Image memory activity tracking failed: ${message}`)
  }
}

type ImageMessageCandidate = {
  imageUrl: string
  sceneSummary?: string
  imagePrompt?: string
  imageVisualSummary?: string
  content: string
  sourceConversationId?: string
  occurredAt?: string
  sourceType: 'current_conversation' | 'activity_history'
  relatedText?: string
  relatedCharacterIds?: string[]
  relatedCharacterNames?: string[]
  interactionTargets?: unknown
}

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9aeiouäöüß]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 2 && !QUERY_STOPWORDS.has(item))

const QUERY_STOPWORDS = new Set([
  'bitte',
  'kannst',
  'kannstdu',
  'koenntest',
  'könntest',
  'mir',
  'mich',
  'mein',
  'meine',
  'dein',
  'deine',
  'das',
  'dass',
  'dieses',
  'diesem',
  'dieser',
  'eine',
  'einen',
  'einem',
  'einer',
  'mit',
  'von',
  'aus',
  'und',
  'oder',
  'nochmal',
  'wieder',
  'zeigen',
  'zeig',
  'bild',
  'szene',
  'hast',
  'habe',
  'mal',
  'bitte',
])

const chooseImageCandidate = (
  candidates: ImageMessageCandidate[],
  queryText: string,
): { candidate: ImageMessageCandidate; reason: 'latest' | 'query_match' } | null => {
  if (candidates.length === 0) return null
  const normalizedQuery = queryText.trim()
  if (!normalizedQuery) {
    return { candidate: candidates[0], reason: 'latest' }
  }

  const tokens = tokenize(normalizedQuery)
  if (tokens.length === 0) {
    return { candidate: candidates[0], reason: 'latest' }
  }

  let bestCandidate: ImageMessageCandidate | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    const haystack =
      `${candidate.sceneSummary ?? ''} ${candidate.imagePrompt ?? ''} ${candidate.imageVisualSummary ?? ''} ${candidate.content} ${candidate.relatedText ?? ''}`.toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (haystack.includes(token)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      bestCandidate = candidate
    }
  }

  if (bestCandidate && bestScore > 0) return { candidate: bestCandidate, reason: 'query_match' }
  return { candidate: candidates[0], reason: 'latest' }
}

const sortCandidatesByRecency = (candidates: ImageMessageCandidate[]): ImageMessageCandidate[] =>
  candidates
    .slice()
    .sort((a, b) => {
      const aTime = a.occurredAt ? new Date(a.occurredAt).getTime() : Number.NaN
      const bTime = b.occurredAt ? new Date(b.occurredAt).getTime() : Number.NaN
      const aSafe = Number.isFinite(aTime) ? aTime : 0
      const bSafe = Number.isFinite(bTime) ? bTime : 0
      return bSafe - aSafe
    })

const dedupeCandidates = (candidates: ImageMessageCandidate[]): ImageMessageCandidate[] => {
  const seen = new Set<string>()
  const deduped: ImageMessageCandidate[] = []
  for (const candidate of candidates) {
    const key = `${candidate.imageUrl}|${candidate.sourceConversationId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(candidate)
  }
  return deduped
}

const extractImageId = (imageUrl: string): string => {
  const normalized = imageUrl.trim()
  if (!normalized) return ''
  const noQuery = normalized.split('?')[0]
  const lastSegment = noQuery.split('/').filter(Boolean).at(-1) ?? ''
  return lastSegment.replace(/\.[a-z0-9]+$/i, '').toLowerCase()
}

const pickPreferredCandidate = (
  candidates: ImageMessageCandidate[],
  preferredImageUrl: string,
  preferredImageId: string,
): ImageMessageCandidate | null => {
  const normalizedUrl = preferredImageUrl.trim()
  const normalizedId = preferredImageId.trim().toLowerCase()
  if (!normalizedUrl && !normalizedId) return null
  for (const candidate of candidates) {
    if (normalizedUrl && candidate.imageUrl.trim() === normalizedUrl) {
      return candidate
    }
    if (normalizedId && extractImageId(candidate.imageUrl) === normalizedId) {
      return candidate
    }
  }
  return null
}

const describeImageWithFastModel = async (input: {
  imageUrl: string
  sceneSummary?: string
  fallbackText?: string
}): Promise<string> => {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return ''
  const imageUrl = input.imageUrl.trim()
  if (!imageUrl) return ''
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  'Beschreibe dieses Bild in genau 1-2 kurzen deutschen Saetzen fuer ein Kind.',
                  'Nenne nur sichtbare Inhalte (Figuren, Handlung, Umgebung, Stimmung, Farben).',
                  'Keine Vermutungen, keine Meta-Erklaerung, keine Aufzaehlung.',
                  input.sceneSummary
                    ? `Szenenkontext (optional): ${input.sceneSummary}`
                    : input.fallbackText
                      ? `Zusatzkontext (optional): ${input.fallbackText}`
                      : '',
                ]
                  .filter((line) => line.length > 0)
                  .join('\n'),
              },
              {
                type: 'input_image',
                image_url: imageUrl,
              },
            ],
          },
        ],
        max_output_tokens: 120,
      }),
    })
    if (!response.ok) return ''
    const data = (await response.json()) as {
      output_text?: string
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>
      }>
    }
    const directText = typeof data.output_text === 'string' ? data.output_text.trim() : ''
    if (directText) return directText
    const nestedText = data.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === 'output_text' && typeof item.text === 'string')
      ?.text?.trim()
    return nestedText ?? ''
  } catch {
    return ''
  }
}

export const recallConversationImage = async (
  input: RecallConversationImageInput,
): Promise<RecalledConversationImage | null> => {
  const conversationId = input.conversationId.trim()
  if (!conversationId) return null
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H1',location:'conversationImageMemoryToolService.ts:recallConversationImage:start',message:'Recall gestartet',data:{conversationId,source:input.source,queryText:(input.queryText ?? '').trim()},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  const details = await getConversationDetails(conversationId)
  const runtimeContext = contextFromMetadata(details.conversation.metadata)
  const characterId = details.conversation.characterId
  const characterProfile = await loadCharacterRuntimeProfile(characterId)
  const characterName = characterProfile?.name ?? characterId
  await trackTraceActivitySafely({
    activityType: 'trace.tool.show_image.request',
    summary: 'show_image Recall gestartet',
    conversationId,
    characterId,
    characterName,
    learningGoalIds: runtimeContext.learningGoalIds,
    traceStage: 'tool',
    traceKind: 'request',
    traceSource: input.source === 'api' ? 'api' : 'runtime',
    input: {
      queryText: (input.queryText ?? '').trim(),
      preferredImageUrl: (input.preferredImageUrl ?? '').trim() || undefined,
      preferredImageId: (input.preferredImageId ?? '').trim() || undefined,
    },
  })
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H2',location:'conversationImageMemoryToolService.ts:recallConversationImage:details',message:'Conversation-Details geladen',data:{characterId,messageCount:details.messages.length},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  const imageCandidates: ImageMessageCandidate[] = []
  const currentConversationCandidates: ImageMessageCandidate[] = []
  for (const message of [...details.messages].reverse()) {
    if (message.role !== 'system') continue
    const imageUrl =
      readText(message.metadata?.heroImageUrl) ||
      readText(message.metadata?.imageUrl) ||
      readText(message.metadata?.imageLinkUrl)
    if (!imageUrl) continue
    const metadata = (message.metadata ?? {}) as Record<string, unknown>
    currentConversationCandidates.push({
      imageUrl,
      sceneSummary: readSceneSummaryValue(metadata) ?? readText(message.content),
      imagePrompt: readImagePromptValue(metadata),
      imageVisualSummary: readText(metadata.imageVisualSummary),
      content: message.content,
      sourceConversationId: message.conversationId,
      occurredAt: message.createdAt,
      sourceType: 'current_conversation',
      relatedText: [
        ...readTextList(metadata.relatedCharacterIds),
        ...readTextList(metadata.relatedCharacterNames),
      ]
        .join(' '),
      relatedCharacterIds: readTextList(metadata.relatedCharacterIds),
      relatedCharacterNames: readTextList(metadata.relatedCharacterNames),
      interactionTargets: metadata.interactionTargets,
    })
  }

  const generatedActivities = await listActivities({
    characterId,
    activityType: 'conversation.image.generated',
    limit: 300,
  })
  const recalledActivities = await listActivities({
    characterId,
    activityType: 'conversation.image.recalled',
    limit: 150,
  })

  const activityCandidates: ImageMessageCandidate[] = []
  for (const activity of [...generatedActivities, ...recalledActivities]) {
    const imageUrl =
      readText(activity.metadata.heroImageUrl) ||
      readText(activity.metadata.imageUrl) ||
      readText(activity.metadata.imageLinkUrl) ||
      readText(activity.object.url)
    if (!imageUrl) continue
    const metadata = (activity.metadata ?? {}) as Record<string, unknown>
    activityCandidates.push({
      imageUrl,
      sceneSummary: readCanonicalStoryText({
        activityType: activity.activityType,
        storySummary: activity.storySummary,
        metadata,
      }),
      imagePrompt: readImagePromptValue(metadata),
      imageVisualSummary: readText(metadata.imageVisualSummary),
      content:
        readCanonicalStoryText({
          activityType: activity.activityType,
          storySummary: activity.storySummary,
          metadata,
        }) || activity.activityType,
      sourceConversationId: activity.conversationId,
      occurredAt: activity.occurredAt || activity.createdAt,
      sourceType: 'activity_history',
      relatedText: [
        ...readTextList(metadata.relatedCharacterIds),
        ...readTextList(metadata.relatedCharacterNames),
      ]
        .join(' '),
      relatedCharacterIds: readTextList(metadata.relatedCharacterIds),
      relatedCharacterNames: readTextList(metadata.relatedCharacterNames),
      interactionTargets: metadata.interactionTargets,
    })
  }

  // Fuer "zeige bestehendes Bild"-Momente priorisieren wir zuerst die Activity-Historie
  // und nutzen aktuelle Conversation-Messages nur als Fallback.
  imageCandidates.push(
    ...dedupeCandidates(sortCandidatesByRecency(activityCandidates)),
    ...currentConversationCandidates,
  )
  const orderedCandidates = dedupeCandidates(imageCandidates)
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H3',location:'conversationImageMemoryToolService.ts:recallConversationImage:candidates',message:'Bildkandidaten gesammelt',data:{candidateCount:orderedCandidates.length,currentConversationCandidateCount:currentConversationCandidates.length,activityHistoryCandidateCount:activityCandidates.length,candidateSource:orderedCandidates.length>0?'messages-and-activities':'none'},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  const preferredImageUrl = (input.preferredImageUrl ?? '').trim()
  const preferredImageId = (input.preferredImageId ?? '').trim()
  const preferredCandidate = pickPreferredCandidate(
    orderedCandidates,
    preferredImageUrl,
    preferredImageId,
  )
  const hasStrictPreference = Boolean(preferredImageUrl || preferredImageId)
  const selected = preferredCandidate
    ? { candidate: preferredCandidate, reason: 'query_match' as const }
    : hasStrictPreference
      ? null
      : chooseImageCandidate(orderedCandidates, input.queryText ?? '')
  const fallbackCharacterImage = selected
    ? null
    : (await resolveCharacterImageRefs(characterId)).find((item) => item.path.trim().length > 0) ?? null
  const finalSelection = selected
    ? selected
    : fallbackCharacterImage
      ? {
          candidate: {
            imageUrl: fallbackCharacterImage.path,
            sceneSummary: `${characterName} als Charakterbild`,
            content: `${characterName} zeigt sein Charakterbild.`,
            sourceConversationId: conversationId,
            occurredAt: new Date().toISOString(),
            sourceType: 'activity_history' as const,
            relatedText: characterName,
            relatedCharacterIds: [],
            relatedCharacterNames: [],
            interactionTargets: [],
          },
          reason: 'latest' as const,
        }
      : null
  if (!finalSelection) {
    // #region agent log
    fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H3',location:'conversationImageMemoryToolService.ts:recallConversationImage:no-selection',message:'Kein Bildkandidat auswaehlbar',data:{conversationId},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    await trackTraceActivitySafely({
      activityType: 'trace.tool.show_image.response',
      summary: 'show_image lieferte kein Bild',
      conversationId,
      characterId,
      characterName,
      learningGoalIds: runtimeContext.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'response',
      traceSource: input.source === 'api' ? 'api' : 'runtime',
      output: { found: false },
      ok: false,
      error: 'no-image-found',
    })
    return null
  }
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H4',location:'conversationImageMemoryToolService.ts:recallConversationImage:selected',message:'Bildkandidat ausgewaehlt',data:{reason:finalSelection.reason,sourceConversationId:finalSelection.candidate.sourceConversationId ?? null,imageUrl:finalSelection.candidate.imageUrl},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  const summary =
    finalSelection.reason === 'query_match'
      ? `${characterName} erinnert sich an ein frueheres Bild aus eurer Conversation.`
      : fallbackCharacterImage
        ? `${characterName} zeigt sein Charakterbild als Fallback.`
        : `${characterName} zeigt ein frueheres Bild aus eurer Conversation.`
  const storedImage = await storeConversationImageAsset({
    conversationId,
    imageUrl: finalSelection.candidate.imageUrl,
    requestId: `${Date.now()}`,
    prefix: 'recalled',
  })
  const resolvedImageUrl = storedImage?.localUrl ?? finalSelection.candidate.imageUrl
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H5',location:'conversationImageMemoryToolService.ts:recallConversationImage:resolved-image',message:'Bild-URL aufgeloest',data:{resolvedImageUrl,usedLocalAsset:Boolean(storedImage?.localUrl),originalImageUrl:storedImage?.originalUrl ?? finalSelection.candidate.imageUrl},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  const imageVisualSummary = await describeImageWithFastModel({
    imageUrl: resolvedImageUrl,
    sceneSummary: finalSelection.candidate.sceneSummary,
    fallbackText: finalSelection.candidate.content,
  })
  const relatedCharacterIds = finalSelection.candidate.relatedCharacterIds ?? []
  const relatedCharacterNames = finalSelection.candidate.relatedCharacterNames ?? []
  const parsedInteractionTargets = parseInteractionTargets(finalSelection.candidate.interactionTargets)
  const fallbackInteractionTargets = buildCharacterInteractionTargets(
    relatedCharacterIds.map((characterId, index) => ({
      characterId,
      name: relatedCharacterNames[index],
    })),
  )
  const interactionTargets = parseInteractionTargets([
    ...parsedInteractionTargets,
    ...fallbackInteractionTargets,
  ])
  const interactionMetadata = buildInteractionMetadata(characterId, interactionTargets)
  const summaryWithVisual = imageVisualSummary
    ? `${summary} Darauf zu sehen: ${imageVisualSummary}`
    : summary
  const publicRecallSummary = imageVisualSummary
    ? `${characterName} zeigte noch einmal ein Bild: ${imageVisualSummary}`
    : summaryWithVisual

  await appendConversationMessage({
    conversationId,
    role: 'system',
    content: publicRecallSummary,
    eventType: 'tool.image.recalled',
    metadata: {
      heroImageUrl: resolvedImageUrl,
      imageUrl: resolvedImageUrl,
      imageLinkUrl: resolvedImageUrl,
      originalImageUrl: storedImage?.originalUrl ?? finalSelection.candidate.imageUrl,
      imageAssetPath: storedImage?.localFilePath,
      imageLinkLabel: 'Bild ansehen',
      skillId: GUIDED_EXPLANATION_SKILL?.id,
      toolId: CHARACTER_AGENT_TOOLS.showImage,
      toolIds: GUIDED_EXPLANATION_SKILL?.toolIds ?? [],
      summary: publicRecallSummary,
      sceneSummary: finalSelection.candidate.sceneSummary || undefined,
      imagePrompt: finalSelection.candidate.imagePrompt || undefined,
      source: input.source,
      recallReason: finalSelection.reason,
      sourceConversationId: finalSelection.candidate.sourceConversationId || undefined,
      imageVisualSummary: imageVisualSummary || undefined,
      relatedCharacterIds,
      relatedCharacterNames,
      ...interactionMetadata,
    },
  })

  await trackImageMemoryActivitySafely({
    activityType: 'tool.image.recalled',
    isPublic: false,
    characterId,
    characterName,
    conversationId,
    learningGoalIds: runtimeContext.learningGoalIds,
    imageUrl: resolvedImageUrl,
    metadata: {
      summary: summaryWithVisual,
      skillId: GUIDED_EXPLANATION_SKILL?.id,
      toolId: CHARACTER_AGENT_TOOLS.showImage,
      source: input.source,
      recallReason: finalSelection.reason,
      sceneSummary: finalSelection.candidate.sceneSummary || undefined,
      imagePrompt: finalSelection.candidate.imagePrompt || undefined,
      sourceConversationId: finalSelection.candidate.sourceConversationId || undefined,
      originalImageUrl: storedImage?.originalUrl ?? finalSelection.candidate.imageUrl,
      imageAssetPath: storedImage?.localFilePath,
      imageVisualSummary: imageVisualSummary || undefined,
      relatedCharacterIds,
      relatedCharacterNames,
      ...interactionMetadata,
    },
  })

  await trackImageMemoryActivitySafely({
    activityType: 'conversation.image.recalled',
    isPublic: true,
    characterId,
    characterName,
    conversationId,
    learningGoalIds: runtimeContext.learningGoalIds,
    imageUrl: resolvedImageUrl,
    storySummary: publicRecallSummary,
    metadata: {
      summary: publicRecallSummary,
      sceneSummary: finalSelection.candidate.sceneSummary || publicRecallSummary,
      conversationLinkLabel: 'Conversation ansehen',
      heroImageUrl: resolvedImageUrl,
      imageUrl: resolvedImageUrl,
      imageLinkUrl: resolvedImageUrl,
      imageLinkLabel: 'Bild ansehen',
      skillId: GUIDED_EXPLANATION_SKILL?.id,
      toolId: CHARACTER_AGENT_TOOLS.showImage,
      source: input.source,
      recallReason: finalSelection.reason,
      imagePrompt: finalSelection.candidate.imagePrompt || undefined,
      sourceConversationId: finalSelection.candidate.sourceConversationId || undefined,
      originalImageUrl: storedImage?.originalUrl ?? finalSelection.candidate.imageUrl,
      imageAssetPath: storedImage?.localFilePath,
      imageVisualSummary: imageVisualSummary || undefined,
      relatedCharacterIds,
      relatedCharacterNames,
      ...interactionMetadata,
    },
  })

  await trackTraceActivitySafely({
    activityType: 'trace.tool.show_image.response',
    summary: 'show_image lieferte ein Bild',
    conversationId,
    characterId,
    characterName,
    learningGoalIds: runtimeContext.learningGoalIds,
    traceStage: 'tool',
    traceKind: 'response',
    traceSource: input.source === 'api' ? 'api' : 'runtime',
    output: {
      found: true,
      recallReason: finalSelection.reason,
      imageUrl: resolvedImageUrl,
    },
    ok: true,
  })

  return {
    imageUrl: resolvedImageUrl,
    sceneSummary: finalSelection.candidate.sceneSummary || undefined,
    imagePrompt: finalSelection.candidate.imagePrompt || undefined,
    reason: finalSelection.reason,
  }
}
