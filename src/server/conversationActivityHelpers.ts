import type { ConversationMessageRecord, ConversationMetadata } from './conversationStore.ts'

const DEFAULT_COUNTERPART_PERSON = 'Yoko'
const TECHNICAL_EVENT_PREFIXES = ['trace.', 'tool.', 'runtime.', 'skill.']

export type PublicConversationHistoryMessage = {
  role: 'user' | 'assistant'
  content: string
  eventType?: string
  createdAt: string
}

const capitalizeWord = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

export const formatCharacterDisplayName = (value: string): string => {
  const normalized = value
    .trim()
    .split(/[-_]/)
    .map((part) => capitalizeWord(part))
    .filter((part) => part.length > 0)
    .join(' ')
  return normalized || value
}

export const resolveCounterpartName = (metadata: ConversationMetadata | undefined): string => {
  const candidates = [metadata?.counterpartName, metadata?.userName, metadata?.displayName]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }
  return DEFAULT_COUNTERPART_PERSON
}

export const isPublicConversationMessageRole = (
  role: string,
): role is PublicConversationHistoryMessage['role'] => role === 'user' || role === 'assistant'

export const isTechnicalConversationEventType = (eventType?: string): boolean => {
  const normalized = eventType?.trim() ?? ''
  if (!normalized) return false
  return TECHNICAL_EVENT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

export const toPublicConversationHistory = (
  messages: ConversationMessageRecord[],
): PublicConversationHistoryMessage[] => {
  return messages.flatMap((message) => {
    if (!isPublicConversationMessageRole(message.role)) return []
    if (isTechnicalConversationEventType(message.eventType)) return []
    const content = message.content.trim()
    if (!content) return []
    return [
      {
        role: message.role,
        content,
        eventType: message.eventType,
        createdAt: message.createdAt,
      },
    ]
  })
}

export const buildPublicConversationMessageSummary = (input: {
  role: 'user' | 'assistant' | 'system'
  content: string
  characterId?: string
  conversationMetadata?: ConversationMetadata
}): string => {
  const content = input.content.trim()
  if (!content) return ''
  const speakerName =
    input.role === 'assistant'
      ? formatCharacterDisplayName(input.characterId?.trim() || 'Character')
      : resolveCounterpartName(input.conversationMetadata)
  return `${speakerName}: ${content}`
}
