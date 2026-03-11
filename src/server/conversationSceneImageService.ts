import { getConversationDetails } from './conversationStore.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'
import { trackTraceActivitySafely } from './traceActivity.ts'
const MAX_PROMPT_LENGTH = 700
const PAST_OR_MEMORY_CUE_RE =
  /(erinner|erinnerst|weisst du noch|weißt du noch|damals|frueher|früher|letztes mal|vorherige conversation|fruehere conversation|frühere conversation|vorhin|schon|bereits|wieder|nochmal|noch einmal|gestern|frueheren|früheren)/i
const VISUAL_REQUEST_RE =
  /(bild|szene|zeigen|zeig|illustrier|zeichn|mal\s+mir|visualisier|generier|erstell|erschaff|mach.*bild)/i
const EXPLICIT_NEW_IMAGE_RE =
  /(neues?\s+bild|neue\s+szene|bild.*neu|bild.*erstellen|bild.*generier|generier.*bild|erstell.*bild|erschaff.*bild|male.*bild|zeichne.*bild|illustrie?re.*bild|visualisiere?.*bild|mach.*neues?\s+bild)/i
const FUTURE_CUE_RE =
  /(in\s+zukunft|spaeter|später|morgen|naechstes?\s+mal|nächstes?\s+mal|als\s+naechstes|als\s+nächstes|fuer\s+spaeter|für\s+später|fuer\s+morgen|für\s+morgen)/i
const pendingExplicitImageRequestsByConversation = new Map<string, string>()

const clampText = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_LENGTH)

const hasExplicitImageRequest = (userText: string): boolean => {
  const normalized = clampText(userText)
  if (!normalized) return false
  if (PAST_OR_MEMORY_CUE_RE.test(normalized)) return false
  if (!VISUAL_REQUEST_RE.test(normalized)) return false

  const asksExplicitlyForNewImage =
    EXPLICIT_NEW_IMAGE_RE.test(normalized) || /(^|\s)neu($|\s)/i.test(normalized)
  const pointsToFuture = FUTURE_CUE_RE.test(normalized)
  return asksExplicitlyForNewImage || pointsToFuture
}

export const noteExplicitImageRequestFromUserMessage = (input: {
  conversationId: string
  userText: string
}): void => {
  const conversationId = input.conversationId.trim()
  if (!conversationId) return
  const userText = clampText(input.userText)
  if (!hasExplicitImageRequest(userText)) return
  pendingExplicitImageRequestsByConversation.set(conversationId, userText)
  console.log(`[conversation-image] queued explicit new-image request (conversationId=${conversationId})`)
}

export const clearExplicitImageRequestForConversation = (conversationId: string): void => {
  const normalized = conversationId.trim()
  if (!normalized) return
  pendingExplicitImageRequestsByConversation.delete(normalized)
}

export const maybeGenerateSceneImageFromAssistantMessage = async (input: {
  conversationId: string
  assistantText: string
  eventType?: string
}): Promise<void> => {
  const conversationId = input.conversationId.trim()
  if (!conversationId) return
  let preloadedTraceCharacterId: string | undefined
  let preloadedTraceLearningGoalIds: string[] | undefined
  try {
    const details = await getConversationDetails(conversationId)
    preloadedTraceCharacterId = details.conversation.characterId
    preloadedTraceLearningGoalIds = contextFromMetadata(details.conversation.metadata).learningGoalIds
  } catch {
    // Wenn die Conversation nicht geladen werden kann, loggen wir ohne Character-Felder.
  }
  await trackTraceActivitySafely({
    activityType: 'trace.tool.generate_image.request',
    summary: 'generate_image deaktiviert',
    conversationId,
    characterId: preloadedTraceCharacterId,
    learningGoalIds: preloadedTraceLearningGoalIds,
    traceStage: 'tool',
    traceKind: 'request',
    traceSource: 'runtime',
    input: {
      eventType: input.eventType,
      assistantText: input.assistantText,
    },
    output: {
      disabled: true,
      reason: 'scene-flow-only',
    },
    ok: true,
  })
}
