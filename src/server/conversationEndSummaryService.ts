import { createActivity, listActivities, type ActivityRecord } from './activityStore.ts'
import {
  getConversationDetails,
  mergeConversationMetadata,
  type ConversationRecord,
} from './conversationStore.ts'
import {
  formatCharacterDisplayName,
  resolveCounterpartName,
  toPublicConversationHistory,
  type PublicConversationHistoryMessage,
} from './conversationActivityHelpers.ts'
import { getOpenAiApiKey, readServerEnv } from './openAiConfig.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const CONVERSATION_END_SUMMARY_MODEL = readServerEnv('CONVERSATION_END_SUMMARY_MODEL', 'gpt-5.4')
const ACTIVITY_PAGE_SIZE = 200
const MAX_ACTIVITY_PAGES = 20
const CONVERSATION_LINK_LABEL = 'Conversation ansehen'

type PublicActivitySummary = {
  activityType: string
  summary: string
  occurredAt: string
}

type StoryTimelineEntry =
  | {
      type: 'message'
      role: 'user' | 'assistant'
      content: string
      occurredAt: string
    }
  | {
      type: 'activity'
      activityType: string
      summary: string
      occurredAt: string
    }

export type ConversationEndSummaryResult = {
  conversation: ConversationRecord
  summary: string
  publicHistory: PublicConversationHistoryMessage[]
  publicActivitySummaries: PublicActivitySummary[]
}

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const isNarrativePublicActivity = (activity: ActivityRecord): boolean => {
  if (activity.isPublic !== true) return false
  if (activity.activityType === 'conversation.message.created') return false
  if (activity.activityType === 'character.chat.completed') return false
  if (activity.activityType === 'conversation.story.summarized') return false
  if (activity.activityType.startsWith('trace.')) return false
  if (activity.activityType.startsWith('tool.')) return false
  if (activity.activityType.startsWith('runtime.')) return false
  if (activity.activityType.startsWith('skill.')) return false
  return true
}

const readActivitySummary = (activity: ActivityRecord): string => {
  const storySummary = readText(activity.storySummary)
  if (storySummary) return storySummary
  const metadata = (activity.metadata ?? {}) as Record<string, unknown>
  const summary = readText(metadata.summary)
  if (summary) return summary
  const visualSummary = readText(metadata.imageVisualSummary)
  if (visualSummary) return visualSummary
  return ''
}

const activityTimeValue = (value: { occurredAt?: string; createdAt?: string }): number => {
  const occurredAt = value.occurredAt ? new Date(value.occurredAt).getTime() : Number.NaN
  if (Number.isFinite(occurredAt)) return occurredAt
  const createdAt = value.createdAt ? new Date(value.createdAt).getTime() : Number.NaN
  if (Number.isFinite(createdAt)) return createdAt
  return 0
}

const loadAllActivities = async (input: {
  characterId?: string
  conversationId?: string
  isPublic?: boolean
}): Promise<ActivityRecord[]> => {
  const collected: ActivityRecord[] = []
  for (let page = 0; page < MAX_ACTIVITY_PAGES; page += 1) {
    const offset = page * ACTIVITY_PAGE_SIZE
    const items = await listActivities({
      characterId: input.characterId,
      conversationId: input.conversationId,
      isPublic: input.isPublic,
      limit: ACTIVITY_PAGE_SIZE,
      offset,
    })
    collected.push(...items)
    if (items.length < ACTIVITY_PAGE_SIZE) break
  }
  return collected
}

const buildStoryTimeline = (input: {
  publicHistory: PublicConversationHistoryMessage[]
  publicActivitySummaries: PublicActivitySummary[]
}): StoryTimelineEntry[] => {
  return [
    ...input.publicHistory.map((message) => ({
      type: 'message' as const,
      role: message.role,
      content: message.content,
      occurredAt: message.createdAt,
    })),
    ...input.publicActivitySummaries.map((activity) => ({
      type: 'activity' as const,
      activityType: activity.activityType,
      summary: activity.summary,
      occurredAt: activity.occurredAt,
    })),
  ].sort((a, b) => activityTimeValue({ occurredAt: a.occurredAt }) - activityTimeValue({ occurredAt: b.occurredAt }))
}

const buildRecentCharacterStorySoFar = (activities: ActivityRecord[], conversationId: string): string[] => {
  return activities
    .filter((activity) => activity.conversationId !== conversationId)
    .filter(isNarrativePublicActivity)
    .map((activity) => readActivitySummary(activity))
    .filter((summary) => summary.length > 0)
    .slice(0, 8)
    .reverse()
}

const buildFallbackConversationSummary = (input: {
  characterName: string
  counterpartName: string
  publicHistory: PublicConversationHistoryMessage[]
  publicActivitySummaries: PublicActivitySummary[]
}): string => {
  const firstWish =
    input.publicHistory.find((message) => message.role === 'user')?.content ??
    input.publicActivitySummaries[0]?.summary ??
    ''
  const latestMoment =
    input.publicActivitySummaries.at(-1)?.summary ?? input.publicHistory.at(-1)?.content ?? ''
  if (firstWish && latestMoment) {
    return normalizeWhitespace(
      `${input.characterName} erlebte mit ${input.counterpartName} ein neues Kapitel: Aus "${firstWish}" wurde schliesslich ${latestMoment}.`,
    )
  }
  if (firstWish) {
    return normalizeWhitespace(
      `${input.characterName} erlebte mit ${input.counterpartName} ein neues Kapitel und ging auf den Wunsch "${firstWish}" ein.`,
    )
  }
  return normalizeWhitespace(
    `${input.characterName} erlebte mit ${input.counterpartName} ein ruhiges neues Kapitel ihrer gemeinsamen Geschichte.`,
  )
}

const generateConversationEndSummary = async (input: {
  characterName: string
  counterpartName: string
  publicHistory: PublicConversationHistoryMessage[]
  publicActivitySummaries: PublicActivitySummary[]
  recentCharacterStorySoFar: string[]
}): Promise<string> => {
  const fallback = buildFallbackConversationSummary(input)
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return fallback

  const timeline = buildStoryTimeline({
    publicHistory: input.publicHistory,
    publicActivitySummaries: input.publicActivitySummaries,
  })

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CONVERSATION_END_SUMMARY_MODEL,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content: [
              'Du bist ein warmherziger Kinder-Geschichtenerzaehler.',
              'Fasse eine beendete Conversation als nahtlosen naechsten Abschnitt der laufenden Geschichte zusammen.',
              'Nutze dafuer die gesamte public Conversation-Historie und die oeffentlichen Story-Aktivitaeten.',
              `Die Hauptfigur heisst ${input.characterName}.`,
              `Die Gespraechspartnerin bzw. das Kind heisst ${input.counterpartName}.`,
              '',
              'Regeln:',
              '- Schreibe genau 2-3 kurze Saetze auf Deutsch in Vergangenheitsform.',
              '- Fasse high level zusammen, was wirklich passiert ist.',
              '- Verbinde Dialog, Erinnerungen, neue Szenen und Handlungen zu einem runden Geschichtsabschnitt.',
              '- Betone Inhalte und Entwicklung, nicht das technische Medium.',
              '- Erzeuge KEIN Bild und erwaehne keine Tools, Prompts, Modelle oder Generierung.',
              '- Klinge wie ein Kinderbuch und bette den Abschnitt nahtlos in die laufende Gesamtgeschichte ein.',
              '',
              'Erzaehlfluss:',
              '- Beginne den Abschnitt so, dass er nahtlos an den vorherigen Story-Kontext anschliesst. Kein harter Reset, sondern ein weiches Weiterfuehren.',
              `- Erwaehne ${input.counterpartName} als aktive Teilnehmerin der Geschichte, nicht nur als Zuhoererin.`,
              '- Schliesse mit einem Satz, der leise Neugier auf das naechste Kapitel weckt -- eine offene Frage, ein Ausblick oder ein kleines Geheimnis.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              instruction:
                'Erzeuge eine high-level Abschluss-Zusammenfassung fuer diese beendete Conversation.',
              recentCharacterStorySoFar: input.recentCharacterStorySoFar,
              publicConversationTimeline: timeline,
            }),
          },
        ],
      }),
    })
    if (!response.ok) return fallback
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = readText(body?.choices?.[0]?.message?.content)
    return content ? normalizeWhitespace(content) : fallback
  } catch {
    return fallback
  }
}

export const createConversationEndSummary = async (
  conversation: ConversationRecord,
): Promise<ConversationEndSummaryResult> => {
  const details = await getConversationDetails(conversation.conversationId)
  const publicHistory = toPublicConversationHistory(details.messages)
  const publicConversationActivities = await loadAllActivities({
    conversationId: conversation.conversationId,
    isPublic: true,
  })
  const publicActivitySummaries = publicConversationActivities
    .filter(isNarrativePublicActivity)
    .map((activity) => ({
      activityType: activity.activityType,
      summary: readActivitySummary(activity),
      occurredAt: activity.occurredAt,
    }))
    .filter((activity) => activity.summary.length > 0)
    .sort((a, b) => activityTimeValue({ occurredAt: a.occurredAt }) - activityTimeValue({ occurredAt: b.occurredAt }))

  const characterName = formatCharacterDisplayName(conversation.characterId)
  const counterpartName = resolveCounterpartName(conversation.metadata)
  const characterPublicActivities = await loadAllActivities({
    characterId: conversation.characterId,
    isPublic: true,
  })
  const recentCharacterStorySoFar = buildRecentCharacterStorySoFar(
    characterPublicActivities,
    conversation.conversationId,
  )
  const summary = await generateConversationEndSummary({
    characterName,
    counterpartName,
    publicHistory,
    publicActivitySummaries,
    recentCharacterStorySoFar,
  })
  const mergedConversation = await mergeConversationMetadata({
    conversationId: conversation.conversationId,
    metadata: {
      storySummary: summary,
      storySummarySource: 'conversation-end-service',
    },
  })
  const context = contextFromMetadata(mergedConversation.metadata)
  await createActivity({
    activityType: 'conversation.story.summarized',
    isPublic: true,
    characterId: mergedConversation.characterId,
    placeId: context.placeId,
    learningGoalIds: context.learningGoalIds,
    conversationId: mergedConversation.conversationId,
    subject: {
      type: 'character',
      id: mergedConversation.characterId,
      name: characterName,
    },
    object: {
      type: 'conversation',
      id: mergedConversation.conversationId,
      counterpartName,
    },
    metadata: {
      ...(mergedConversation.metadata ?? {}),
      summary,
      storySummary: summary,
      conversationLinkLabel: CONVERSATION_LINK_LABEL,
      summarySource: 'conversation-end-service',
      publicMessageCount: publicHistory.length,
      publicActivityCount: publicActivitySummaries.length,
    },
  })

  return {
    conversation: mergedConversation,
    summary,
    publicHistory,
    publicActivitySummaries,
  }
}
