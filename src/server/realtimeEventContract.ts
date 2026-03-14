export const REALTIME_EVENT_SCHEMA_VERSION = '1.0'

export const REALTIME_EVENT_TYPES = [
  'voice.session.requested',
  'voice.instructions.updated',
  'voice.user.transcript.received',
  'voice.assistant.transcript.received',
  'voice.session.ended',
  'voice.session.failed',
] as const

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number]

export type RealtimeEventEnvelope = {
  eventId: string
  correlationId: string
  conversationKey?: string
  characterId: string
  eventType: RealtimeEventType
  occurredAt: string
  payload: Record<string, unknown>
  schemaVersion: string
}

const EVENT_TYPE_SET = new Set<string>(REALTIME_EVENT_TYPES)

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

export const isRealtimeEventType = (value: unknown): value is RealtimeEventType => {
  return typeof value === 'string' && EVENT_TYPE_SET.has(value)
}

export const parseRealtimeEventType = (value: unknown): RealtimeEventType => {
  if (!isRealtimeEventType(value)) {
    throw new Error('eventType ist ungueltig.')
  }
  return value
}

export const buildRealtimeEventEnvelope = (input: {
  eventId: string
  correlationId: string
  conversationKey?: string
  characterId: string
  eventType: RealtimeEventType
  occurredAt?: string
  payload?: Record<string, unknown>
}): RealtimeEventEnvelope => {
  const eventId = normalizeString(input.eventId)
  if (!eventId) throw new Error('eventId ist erforderlich.')

  const correlationId = normalizeString(input.correlationId)
  if (!correlationId) throw new Error('correlationId ist erforderlich.')

  const characterId = normalizeString(input.characterId)
  if (!characterId) throw new Error('characterId ist erforderlich.')

  const conversationKey = normalizeString(input.conversationKey) ?? undefined
  const occurredAt = normalizeString(input.occurredAt) ?? new Date().toISOString()

  return {
    eventId,
    correlationId,
    conversationKey,
    characterId,
    eventType: input.eventType,
    occurredAt,
    payload: input.payload ?? {},
    schemaVersion: REALTIME_EVENT_SCHEMA_VERSION,
  }
}
