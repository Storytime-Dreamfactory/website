import { createActivity, listActivities } from './activityStore.ts'
import {
  CHARACTER_AGENT_TOOLS,
  getCharacterAgentSkillPlaybook,
} from './characterAgentDefinitions.ts'
import { appendConversationMessage, getConversationDetails } from './conversationStore.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'
import { loadCharacterRuntimeProfile } from './runtimeContentStore.ts'
import { storeConversationImageAsset } from './conversationImageAssetStore.ts'

type RecallConversationImageInput = {
  conversationId: string
  queryText?: string
  source: 'runtime' | 'api'
}

export type RecalledConversationImage = {
  imageUrl: string
  scenePrompt?: string
  reason: 'latest' | 'query_match'
}

const GUIDED_EXPLANATION_SKILL = getCharacterAgentSkillPlaybook('guided-explanation')

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const trackImageMemoryActivitySafely = async (input: {
  activityType: string
  isPublic: boolean
  characterId: string
  characterName: string
  conversationId: string
  learningGoalIds?: string[]
  imageUrl: string
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
      metadata: input.metadata,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Image memory activity tracking failed: ${message}`)
  }
}

type ImageMessageCandidate = {
  imageUrl: string
  scenePrompt?: string
  imageVisualSummary?: string
  content: string
  sourceConversationId?: string
}

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9aeiouäöüß]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 2)

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

  const matching = candidates.find((candidate) => {
    const haystack = `${candidate.scenePrompt ?? ''} ${candidate.imageVisualSummary ?? ''} ${candidate.content}`.toLowerCase()
    return tokens.some((token) => haystack.includes(token))
  })

  if (matching) return { candidate: matching, reason: 'query_match' }
  return { candidate: candidates[0], reason: 'latest' }
}

const describeImageWithFastModel = async (input: {
  imageUrl: string
  scenePrompt?: string
  fallbackText?: string
}): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
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
        model: 'gpt-4o-mini',
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
                  input.scenePrompt
                    ? `Szenenkontext (optional): ${input.scenePrompt}`
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
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H2',location:'conversationImageMemoryToolService.ts:recallConversationImage:details',message:'Conversation-Details geladen',data:{characterId,messageCount:details.messages.length},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  const imageCandidates: ImageMessageCandidate[] = []
  for (const message of [...details.messages].reverse()) {
    if (message.role !== 'system') continue
    const imageUrl =
      readText(message.metadata?.heroImageUrl) ||
      readText(message.metadata?.imageUrl) ||
      readText(message.metadata?.imageLinkUrl)
    if (!imageUrl) continue
    imageCandidates.push({
      imageUrl,
      scenePrompt: readText(message.metadata?.scenePrompt),
      imageVisualSummary: readText(message.metadata?.imageVisualSummary),
      content: message.content,
      sourceConversationId: message.conversationId,
    })
  }

  if (imageCandidates.length === 0) {
    const generatedActivities = await listActivities({
      characterId,
      activityType: 'conversation.image.generated',
      limit: 40,
    })
    const recalledActivities = await listActivities({
      characterId,
      activityType: 'conversation.image.recalled',
      limit: 20,
    })
    for (const activity of [...generatedActivities, ...recalledActivities]) {
      const imageUrl =
        readText(activity.metadata.heroImageUrl) ||
        readText(activity.metadata.imageUrl) ||
        readText(activity.metadata.imageLinkUrl) ||
        readText(activity.object.url)
      if (!imageUrl) continue
      imageCandidates.push({
        imageUrl,
        scenePrompt: readText(activity.metadata.scenePrompt),
        imageVisualSummary: readText(activity.metadata.imageVisualSummary),
        content: readText(activity.metadata.summary) || activity.activityType,
        sourceConversationId: activity.conversationId,
      })
    }
  }
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H3',location:'conversationImageMemoryToolService.ts:recallConversationImage:candidates',message:'Bildkandidaten gesammelt',data:{candidateCount:imageCandidates.length,candidateSource:imageCandidates.length>0?'messages-or-activities':'none'},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  const selected = chooseImageCandidate(imageCandidates, input.queryText ?? '')
  if (!selected) {
    // #region agent log
    fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H3',location:'conversationImageMemoryToolService.ts:recallConversationImage:no-selection',message:'Kein Bildkandidat auswaehlbar',data:{conversationId},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    return null
  }
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H4',location:'conversationImageMemoryToolService.ts:recallConversationImage:selected',message:'Bildkandidat ausgewaehlt',data:{reason:selected.reason,sourceConversationId:selected.candidate.sourceConversationId ?? null,imageUrl:selected.candidate.imageUrl},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  const summary =
    selected.reason === 'query_match'
      ? `${characterName} erinnert sich an ein frueheres Bild aus eurer Conversation.`
      : `${characterName} zeigt ein frueheres Bild aus eurer Conversation.`
  const storedImage = await storeConversationImageAsset({
    conversationId,
    imageUrl: selected.candidate.imageUrl,
    requestId: `${Date.now()}`,
    prefix: 'recalled',
  })
  const resolvedImageUrl = storedImage?.localUrl ?? selected.candidate.imageUrl
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H5',location:'conversationImageMemoryToolService.ts:recallConversationImage:resolved-image',message:'Bild-URL aufgeloest',data:{resolvedImageUrl,usedLocalAsset:Boolean(storedImage?.localUrl),originalImageUrl:storedImage?.originalUrl ?? selected.candidate.imageUrl},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  const imageVisualSummary = await describeImageWithFastModel({
    imageUrl: resolvedImageUrl,
    scenePrompt: selected.candidate.scenePrompt,
    fallbackText: selected.candidate.content,
  })
  const summaryWithVisual = imageVisualSummary
    ? `${summary} Darauf zu sehen: ${imageVisualSummary}`
    : summary

  await appendConversationMessage({
    conversationId,
    role: 'system',
    content: summaryWithVisual,
    eventType: 'tool.image.recalled',
    metadata: {
      heroImageUrl: resolvedImageUrl,
      imageUrl: resolvedImageUrl,
      imageLinkUrl: resolvedImageUrl,
      originalImageUrl: storedImage?.originalUrl ?? selected.candidate.imageUrl,
      imageAssetPath: storedImage?.localFilePath,
      imageLinkLabel: 'Bild ansehen',
      skillId: GUIDED_EXPLANATION_SKILL?.id,
      toolId: CHARACTER_AGENT_TOOLS.displayExistingImage,
      toolIds: GUIDED_EXPLANATION_SKILL?.toolIds ?? [],
      scenePrompt: selected.candidate.scenePrompt || undefined,
      source: input.source,
      recallReason: selected.reason,
      sourceConversationId: selected.candidate.sourceConversationId || undefined,
      imageVisualSummary: imageVisualSummary || undefined,
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
      toolId: CHARACTER_AGENT_TOOLS.displayExistingImage,
      source: input.source,
      recallReason: selected.reason,
      scenePrompt: selected.candidate.scenePrompt || undefined,
      sourceConversationId: selected.candidate.sourceConversationId || undefined,
      originalImageUrl: storedImage?.originalUrl ?? selected.candidate.imageUrl,
      imageAssetPath: storedImage?.localFilePath,
      imageVisualSummary: imageVisualSummary || undefined,
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
    metadata: {
      summary: summaryWithVisual,
      conversationLinkLabel: 'Conversation ansehen',
      heroImageUrl: resolvedImageUrl,
      imageUrl: resolvedImageUrl,
      imageLinkUrl: resolvedImageUrl,
      imageLinkLabel: 'Bild ansehen',
      skillId: GUIDED_EXPLANATION_SKILL?.id,
      toolId: CHARACTER_AGENT_TOOLS.displayExistingImage,
      source: input.source,
      recallReason: selected.reason,
      scenePrompt: selected.candidate.scenePrompt || undefined,
      sourceConversationId: selected.candidate.sourceConversationId || undefined,
      originalImageUrl: storedImage?.originalUrl ?? selected.candidate.imageUrl,
      imageAssetPath: storedImage?.localFilePath,
      imageVisualSummary: imageVisualSummary || undefined,
    },
  })

  return {
    imageUrl: resolvedImageUrl,
    scenePrompt: selected.candidate.scenePrompt || undefined,
    reason: selected.reason,
  }
}
