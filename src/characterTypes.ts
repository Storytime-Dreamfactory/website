export type ApiRelationshipObject = {
  id: string
  name: string
  type: string
  slug: string
}

export type ApiRelationship = {
  relationshipId: string
  source: ApiRelationshipObject
  target: ApiRelationshipObject
  relationshipType: string
  fromTitle?: string
  toTitle?: string
  relationshipTypeReadable?: string
  relationship: string
  direction: 'outgoing' | 'incoming'
}

export type ApiActivityData = Record<string, unknown>

export type ApiActivityRecord = {
  activityId: string
  activityType: string
  isPublic: boolean
  characterId?: string
  placeId?: string
  learningGoalIds: string[]
  conversationId?: string
  subject: ApiActivityData
  object: ApiActivityData
  metadata: ApiActivityData
  storySummary?: string
  occurredAt: string
  createdAt: string
}

export type TraceToolEvent = {
  toolId: string
  kind: 'request' | 'response' | 'error'
}

export type SummaryCharacterLink = {
  id: string
  name: string
}

export type ApiConversationMessageRecord = {
  messageId: number
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  eventType?: string
  createdAt: string
  metadata?: ApiActivityData
}

export type ApiConversationRecord = {
  conversationId: string
  userId?: string
  characterId: string
  startedAt: string
  endedAt?: string
  metadata?: ApiActivityData
}

export type ApiConversationDetails = {
  conversation: ApiConversationRecord
  messages: ApiConversationMessageRecord[]
}

export type HeroViewMode = 'latest-activity' | 'character-hero'

export const HERO_TRANSITION_MS = 2300
export const MEMORY_OVERLAY_MS = 4600
export const MEMORY_OVERLAY_CHARACTER_IDS = new Set(['yoko'])
export const FIXED_USER_NAME = 'Yoko'
export const ACTIVITY_PAGE_SIZE = 500
export const MAX_ACTIVITY_PAGES = 20

const UUID_LIKE_RE = /^[0-9a-f]{8}(?:[-\s]?[0-9a-f]{4}){3}[-\s]?[0-9a-f]{12}$/i

export const looksLikeUuid = (value: string | undefined): boolean => {
  const normalized = value?.trim()
  if (!normalized) return false
  return UUID_LIKE_RE.test(normalized)
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const buildUuidLikeValueRegex = (value: string): RegExp | null => {
  const normalized = value.trim()
  if (!looksLikeUuid(normalized)) return null
  const hex = normalized.replace(/[^a-f0-9]/gi, '')
  if (hex.length !== 32) return null
  const pattern = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('[-\\s]?')
  return new RegExp(pattern, 'gi')
}

export const readTextValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export const readTextList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

export const readActivityDisplayValue = (value: ApiActivityData | undefined): string | undefined =>
  readTextValue(value?.text) ??
  readTextValue(value?.name) ??
  readTextValue(value?.label) ??
  readTextValue(value?.title)

export const readConversationMessageRole = (
  activity: ApiActivityRecord,
): ApiConversationMessageRecord['role'] | undefined => {
  const role = readTextValue(activity.object?.role) ?? readTextValue(activity.metadata?.messageRole)
  if (role === 'user' || role === 'assistant' || role === 'system') return role
  return undefined
}

const resolveConversationCounterpartName = (activity: ApiActivityRecord): string | undefined => {
  const candidates = [
    readTextValue(activity.metadata?.counterpartName),
    readTextValue(activity.metadata?.userName),
    readTextValue(activity.metadata?.displayName),
    readActivityDisplayValue(activity.subject),
  ]
  return candidates.find((candidate) => candidate && !looksLikeUuid(candidate))
}

const resolveConversationAssistantName = (activity: ApiActivityRecord, characterName: string): string => {
  const subjectName = readActivityDisplayValue(activity.subject)
  if (subjectName && !looksLikeUuid(subjectName)) return subjectName
  return characterName
}

export const resolveActivitySubjectLabel = (activity: ApiActivityRecord, characterName: string): string => {
  const role = readConversationMessageRole(activity)
  if (activity.activityType === 'conversation.message.created' && role === 'user') {
    return resolveConversationCounterpartName(activity) ?? FIXED_USER_NAME
  }
  if (activity.activityType === 'conversation.message.created' && role === 'assistant') {
    return resolveConversationAssistantName(activity, characterName)
  }
  return readActivityDisplayValue(activity.subject) ?? characterName
}

export const normalizeConversationMessageSummary = (
  activity: ApiActivityRecord,
  summary: string,
  characterName: string,
): string => {
  const trimmedSummary = summary.trim()
  if (!trimmedSummary || activity.activityType !== 'conversation.message.created') return trimmedSummary

  const role = readConversationMessageRole(activity)
  if (!role) return trimmedSummary

  const speakerName =
    role === 'assistant'
      ? resolveConversationAssistantName(activity, characterName)
      : resolveConversationCounterpartName(activity) ?? FIXED_USER_NAME

  const match = trimmedSummary.match(/^([^:]{1,160}):\s*(.+)$/s)
  if (!match) return `${speakerName}: ${trimmedSummary}`

  const [, prefix, content] = match
  const subjectId = readTextValue(activity.subject?.id)
  const subjectName = readActivityDisplayValue(activity.subject)
  const normalizedPrefix = prefix.trim()
  const matchesKnownSubject =
    normalizedPrefix === subjectId || normalizedPrefix === subjectName || looksLikeUuid(normalizedPrefix)

  if (!matchesKnownSubject || normalizedPrefix === speakerName) {
    return trimmedSummary
  }

  return `${speakerName}: ${content.trimStart()}`
}

export const normalizeLegacyCharacterNamesInSummary = (input: {
  activity: ApiActivityRecord
  summary: string
  characterName: string
  allCharactersById: Map<string, { id: string; name: string }>
}): string => {
  const normalizedSummary = input.summary.trim()
  if (!normalizedSummary) return normalizedSummary

  const replacements = new Map<string, string>()
  const addReplacement = (id: string | undefined, name: string | undefined) => {
    const normalizedId = id?.trim()
    const normalizedName = name?.trim()
    if (!normalizedId || !normalizedName) return
    if (!looksLikeUuid(normalizedId)) return
    if (looksLikeUuid(normalizedName)) return
    replacements.set(normalizedId, normalizedName)
  }

  addReplacement(input.activity.characterId, input.characterName)
  addReplacement(readTextValue(input.activity.subject?.id), readActivityDisplayValue(input.activity.subject))
  addReplacement(readTextValue(input.activity.object?.id), readActivityDisplayValue(input.activity.object))

  const relatedIds = readTextList(input.activity.metadata.relatedCharacterIds)
  const relatedNames = readTextList(input.activity.metadata.relatedCharacterNames)
  relatedIds.forEach((id, index) => {
    const knownCharacter = input.allCharactersById.get(id)
    addReplacement(id, relatedNames[index] ?? knownCharacter?.name)
  })

  for (const target of readInteractionTargets(input.activity)) {
    addReplacement(target.id, target.name)
  }

  let result = normalizedSummary
  for (const [id, name] of replacements) {
    const uuidRegex = buildUuidLikeValueRegex(id)
    if (uuidRegex) {
      result = result.replace(uuidRegex, name)
      continue
    }
    result = result.replace(new RegExp(escapeRegex(id), 'g'), name)
  }

  return result
}

const readLocalAssetUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replaceAll('\\', '/')
  if (!normalized) return undefined
  if (normalized.startsWith('/content/')) return normalized
  if (normalized.startsWith('content/')) return `/${normalized}`

  const publicMarker = '/public/'
  const publicMarkerIndex = normalized.lastIndexOf(publicMarker)
  if (publicMarkerIndex !== -1) {
    const relativeToPublic = normalized.slice(publicMarkerIndex + publicMarker.length)
    if (relativeToPublic.startsWith('content/')) return `/${relativeToPublic}`
  }

  const directPublicPrefix = 'public/'
  if (normalized.startsWith(directPublicPrefix)) {
    const relativeToPublic = normalized.slice(directPublicPrefix.length)
    if (relativeToPublic.startsWith('content/')) return `/${relativeToPublic}`
  }

  return undefined
}

const isLikelyBflUrl = (value: string): boolean => {
  const normalized = value.toLowerCase()
  return normalized.includes('bfl') || normalized.includes('black-forest-labs')
}

const pickPreferredImageUrl = (values: unknown[]): string | undefined => {
  type Candidate = { url: string; score: number }
  let best: Candidate | undefined

  for (const raw of values) {
    const localUrl = readLocalAssetUrl(raw)
    if (localUrl) {
      const candidate = { url: localUrl, score: 4 }
      if (!best || candidate.score > best.score) best = candidate
      continue
    }

    const textUrl = readTextValue(raw)
    if (!textUrl) continue

    const isRemote = textUrl.startsWith('http://') || textUrl.startsWith('https://')
    const candidate: Candidate = {
      url: textUrl,
      score: !isRemote ? 3 : isLikelyBflUrl(textUrl) ? 1 : 2,
    }
    if (!best || candidate.score > best.score) best = candidate
  }

  return best?.url
}

export const readActivityImageUrl = (activity: ApiActivityRecord): string | undefined =>
  pickPreferredImageUrl([
    activity.metadata.imageAssetPath,
    activity.metadata.heroImageUrl,
    activity.metadata.imageUrl,
    activity.metadata.imageLinkUrl,
    activity.metadata.originalImageUrl,
    activity.subject.url,
    activity.object.url,
  ])

export const readAllActivityImageUrls = (activity: ApiActivityRecord): string[] => {
  const metadata = activity.metadata
  const imageArrayValues = [
    metadata.imageUrls,
    metadata.generatedImageUrls,
    metadata.images,
    metadata.imageCandidates,
    metadata.generatedImages,
  ]

  const explicitCandidates: unknown[] = [
    metadata.imageAssetPath,
    metadata.heroImageUrl,
    metadata.imageUrl,
    metadata.imageLinkUrl,
    metadata.originalImageUrl,
    activity.subject.url,
    activity.object.url,
  ]

  for (const value of imageArrayValues) {
    if (!Array.isArray(value)) continue
    for (const entry of value) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        explicitCandidates.push(
          (entry as ApiActivityData).url,
          (entry as ApiActivityData).imageUrl,
          (entry as ApiActivityData).imageAssetPath,
          (entry as ApiActivityData).originalImageUrl,
        )
      } else {
        explicitCandidates.push(entry)
      }
    }
  }

  const preferredUrl = readActivityImageUrl(activity)
  const uniqueUrls = new Set<string>()
  if (preferredUrl) {
    const normalizedPreferred = normalizeImageUrl(preferredUrl)
    if (normalizedPreferred) uniqueUrls.add(normalizedPreferred)
  }

  for (const raw of explicitCandidates) {
    const localUrl = readLocalAssetUrl(raw)
    const normalizedLocal = normalizeImageUrl(localUrl)
    if (normalizedLocal) {
      uniqueUrls.add(normalizedLocal)
      continue
    }
    const textUrl = readTextValue(raw)
    const normalizedText = normalizeImageUrl(textUrl)
    if (normalizedText) {
      uniqueUrls.add(normalizedText)
    }
  }

  return Array.from(uniqueUrls)
}

export const readMessageImageUrl = (message: ApiConversationMessageRecord): string | undefined => {
  const metadata = message.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined
  }
  return pickPreferredImageUrl([
    metadata.imageAssetPath,
    metadata.heroImageUrl,
    metadata.imageUrl,
    metadata.imageLinkUrl,
    metadata.originalImageUrl,
  ])
}

export const normalizeImageUrl = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed
  }

  if (trimmed.startsWith('/')) {
    return trimmed
  }

  if (trimmed.startsWith('content/')) {
    return `/${trimmed}`
  }

  if (trimmed.startsWith('./content/')) {
    return `/${trimmed.slice(2)}`
  }

  return trimmed
}

export const formatTimestamp = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export const readInteractionTargets = (activity: ApiActivityRecord): SummaryCharacterLink[] => {
  const rawTargets = activity.metadata.interactionTargets
  if (!Array.isArray(rawTargets)) return []
  return rawTargets.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const target = value as ApiActivityData
    const type = readTextValue(target.type)?.toLowerCase()
    const id = readTextValue(target.id)
    const name = readTextValue(target.name)
    if (type !== 'character' || !id || !name) return []
    return [{ id, name }]
  })
}

export const collectSummaryCharacterLinks = (input: {
  activity: ApiActivityRecord
  allCharactersById: Map<string, { id: string; name: string }>
}): SummaryCharacterLink[] => {
  const links = new Map<string, SummaryCharacterLink>()
  const add = (id: string | undefined, name: string | undefined) => {
    const normalizedId = id?.trim()
    const normalizedName = name?.trim()
    if (!normalizedId || !normalizedName) return
    links.set(normalizedId, { id: normalizedId, name: normalizedName })
  }

  for (const target of readInteractionTargets(input.activity)) {
    add(target.id, target.name)
  }

  for (const id of readTextList(input.activity.metadata.interactionCharacterIds)) {
    const knownCharacter = input.allCharactersById.get(id)
    add(id, knownCharacter?.name)
  }

  const relatedIds = readTextList(input.activity.metadata.relatedCharacterIds)
  const relatedNames = readTextList(input.activity.metadata.relatedCharacterNames)
  relatedIds.forEach((id, index) => {
    const knownCharacter = input.allCharactersById.get(id)
    add(id, relatedNames[index] ?? knownCharacter?.name)
  })

  return [...links.values()]
}

export const buildActivitySummary = (
  activity: ApiActivityRecord,
  characterName: string,
  resolvedSubjectLabel: string,
  resolvedObjectLabel?: string,
): string => {
  const subjectLabel = resolvedSubjectLabel || characterName
  const activityLabel = activity.activityType
  const objectLabel = resolvedObjectLabel || 'none'
  return `${subjectLabel} | ${activityLabel} | ${objectLabel}`
}

export const activityTimeValue = (activity: ApiActivityRecord): number => {
  const occurredAt = new Date(activity.occurredAt).getTime()
  if (Number.isFinite(occurredAt)) return occurredAt
  const createdAt = new Date(activity.createdAt).getTime()
  if (Number.isFinite(createdAt)) return createdAt
  return 0
}

export const sortActivitiesDesc = (items: ApiActivityRecord[]): ApiActivityRecord[] =>
  items.slice().sort((a, b) => activityTimeValue(b) - activityTimeValue(a))

export const readLatestActivityImageUrl = (items: ApiActivityRecord[] | null): string | undefined => {
  if (!items || items.length === 0) return undefined
  for (const activity of items) {
    const imageUrl = normalizeImageUrl(readActivityImageUrl(activity))
    if (imageUrl) return imageUrl
  }
  return undefined
}

export const parseTraceToolEvent = (activity: ApiActivityRecord): TraceToolEvent | null => {
  if (!activity.activityType.startsWith('trace.tool.')) return null
  const traceStage = readTextValue(activity.metadata.traceStage)
  if (traceStage && traceStage !== 'tool') return null
  const match = activity.activityType.match(/^trace\.tool\.([a-z0-9_]+)\.(request|response|error)$/i)
  if (!match) return null
  const metadataKind = readTextValue(activity.metadata.traceKind)
  const kind = (metadataKind ?? match[2]).toLowerCase()
  if (kind !== 'request' && kind !== 'response' && kind !== 'error') return null
  return {
    toolId: match[1],
    kind,
  }
}

export const formatTracePayload = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
