import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { Button, Drawer, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, CopyOutlined, HeartOutlined } from '@ant-design/icons'
import type { StoryContent } from './content/types'
import VoiceChatButton from './VoiceChatButton'
import CharacterActivityStream, { type CharacterActivityItem } from './CharacterActivityStream'
import { shouldShowActivityInPanel } from './activityPanelVisibility'
import { readCanonicalStoryText } from './storyText'

const { Title, Text } = Typography

type Props = {
  content: StoryContent
}

type ApiRelationshipObject = {
  id: string
  name: string
  type: string
  slug: string
}

type ApiRelationship = {
  relationshipId: string
  source: ApiRelationshipObject
  target: ApiRelationshipObject
  relationshipType: string
  relationshipTypeReadable?: string
  relationship: string
  direction: 'outgoing' | 'incoming'
}

type ApiActivityData = Record<string, unknown>

type ApiActivityRecord = {
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

type TraceToolEvent = {
  toolId: string
  kind: 'request' | 'response' | 'error'
}

type SummaryCharacterLink = {
  id: string
  name: string
}

type ApiConversationMessageRecord = {
  messageId: number
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  eventType?: string
  createdAt: string
  metadata?: ApiActivityData
}

type ApiConversationRecord = {
  conversationId: string
  userId?: string
  characterId: string
  startedAt: string
  endedAt?: string
  metadata?: ApiActivityData
}

type ApiConversationDetails = {
  conversation: ApiConversationRecord
  messages: ApiConversationMessageRecord[]
}

type HeroViewMode = 'latest-activity' | 'character-hero'

const HERO_TRANSITION_MS = 1100
const MEMORY_OVERLAY_MS = 4600
const MEMORY_OVERLAY_CHARACTER_IDS = new Set(['yoko'])
const FIXED_USER_NAME = 'Yoko'
const ACTIVITY_PAGE_SIZE = 500
const MAX_ACTIVITY_PAGES = 20
const UUID_LIKE_RE = /^[0-9a-f]{8}(?:[-\s]?[0-9a-f]{4}){3}[-\s]?[0-9a-f]{12}$/i

const looksLikeUuid = (value: string | undefined): boolean => {
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

const readTextValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const readTextList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

const readActivityDisplayValue = (value: ApiActivityData | undefined): string | undefined =>
  readTextValue(value?.text) ??
  readTextValue(value?.name) ??
  readTextValue(value?.label) ??
  readTextValue(value?.title)

const readConversationMessageRole = (
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

const resolveActivitySubjectLabel = (activity: ApiActivityRecord, characterName: string): string => {
  const role = readConversationMessageRole(activity)
  if (activity.activityType === 'conversation.message.created' && role === 'user') {
    return resolveConversationCounterpartName(activity) ?? FIXED_USER_NAME
  }
  if (activity.activityType === 'conversation.message.created' && role === 'assistant') {
    return resolveConversationAssistantName(activity, characterName)
  }
  return readActivityDisplayValue(activity.subject) ?? characterName
}

const normalizeConversationMessageSummary = (
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
  if (!match) return trimmedSummary

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

const normalizeLegacyCharacterNamesInSummary = (input: {
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

const readActivityImageUrl = (activity: ApiActivityRecord): string | undefined =>
  pickPreferredImageUrl([
    activity.metadata.imageAssetPath,
    activity.metadata.heroImageUrl,
    activity.metadata.imageUrl,
    activity.metadata.imageLinkUrl,
    activity.metadata.originalImageUrl,
    activity.subject.url,
    activity.object.url,
  ])

const readAllActivityImageUrls = (activity: ApiActivityRecord): string[] => {
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

const readMessageImageUrl = (message: ApiConversationMessageRecord): string | undefined => {
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

const normalizeImageUrl = (value: string | undefined): string | undefined => {
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

const formatTimestamp = (value: string | Date): string => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)

  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

const readInteractionTargets = (activity: ApiActivityRecord): SummaryCharacterLink[] => {
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

const collectSummaryCharacterLinks = (input: {
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

const buildActivitySummary = (
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

const activityTimeValue = (activity: ApiActivityRecord): number => {
  const occurredAt = new Date(activity.occurredAt).getTime()
  if (Number.isFinite(occurredAt)) return occurredAt
  const createdAt = new Date(activity.createdAt).getTime()
  if (Number.isFinite(createdAt)) return createdAt
  return 0
}

const sortActivitiesDesc = (items: ApiActivityRecord[]): ApiActivityRecord[] =>
  items.slice().sort((a, b) => activityTimeValue(b) - activityTimeValue(a))

const readLatestActivityImageUrl = (items: ApiActivityRecord[] | null): string | undefined => {
  if (!items || items.length === 0) return undefined
  for (const activity of items) {
    const imageUrl = normalizeImageUrl(readActivityImageUrl(activity))
    if (imageUrl) return imageUrl
  }
  return undefined
}

const parseTraceToolEvent = (activity: ApiActivityRecord): TraceToolEvent | null => {
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

const formatTracePayload = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export default function CharacterDetailPage({ content }: Props) {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [reduceMotion, setReduceMotion] = useState(false)
  const pointerFrameRef = useRef<number | null>(null)
  const [apiRelationships, setApiRelationships] = useState<ApiRelationship[] | null>(null)
  const [apiActivities, setApiActivities] = useState<ApiActivityRecord[] | null>(null)
  const [activityStreamConnected, setActivityStreamConnected] = useState(false)
  const [isConversationPanelOpen, setIsConversationPanelOpen] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [conversationDetails, setConversationDetails] = useState<ApiConversationDetails | null>(null)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [conversationError, setConversationError] = useState<string | null>(null)
  const [copiedConversationText, setCopiedConversationText] = useState(false)
  const [activeHeroUrl, setActiveHeroUrl] = useState<string | undefined>(undefined)
  const [heroViewMode, setHeroViewMode] = useState<HeroViewMode>('latest-activity')
  const [incomingHeroUrl, setIncomingHeroUrl] = useState<string | null>(null)
  const [isMemoryOverlayActive, setIsMemoryOverlayActive] = useState(false)
  const heroTransitionTimerRef = useRef<number | null>(null)
  const memoryOverlayTimerRef = useRef<number | null>(null)
  const activeHeroUrlRef = useRef<string | undefined>(undefined)

  const character = useMemo(
    () => content.characters.find((c) => c.id === id),
    [content.characters, id],
  )
  const heroUrl = character?.images.heroImage?.file
  const isHeroParallaxEnabled = Boolean(activeHeroUrl) && !reduceMotion

  useEffect(() => {
    setHeroViewMode('latest-activity')
    setActiveHeroUrl(heroUrl)
    activeHeroUrlRef.current = heroUrl
    setIncomingHeroUrl(null)
    if (heroTransitionTimerRef.current != null) {
      window.clearTimeout(heroTransitionTimerRef.current)
      heroTransitionTimerRef.current = null
    }
  }, [heroUrl, character?.id])

  useEffect(() => {
    activeHeroUrlRef.current = activeHeroUrl
  }, [activeHeroUrl])

  const transitionToHeroUrl = useCallback(
    (nextUrl: string | undefined, options?: { memoryOverlay?: boolean }) => {
      const normalizedNextUrl = normalizeImageUrl(nextUrl)
      if (!normalizedNextUrl || normalizedNextUrl === activeHeroUrlRef.current) return

      if (options?.memoryOverlay && character && MEMORY_OVERLAY_CHARACTER_IDS.has(character.id)) {
        setIsMemoryOverlayActive(true)
        if (memoryOverlayTimerRef.current != null) {
          window.clearTimeout(memoryOverlayTimerRef.current)
        }
        memoryOverlayTimerRef.current = window.setTimeout(() => {
          setIsMemoryOverlayActive(false)
          memoryOverlayTimerRef.current = null
        }, MEMORY_OVERLAY_MS)
      }

      if (reduceMotion) {
        setIncomingHeroUrl(null)
        setActiveHeroUrl(normalizedNextUrl)
        return
      }

      setIncomingHeroUrl(normalizedNextUrl)
      if (heroTransitionTimerRef.current != null) {
        window.clearTimeout(heroTransitionTimerRef.current)
      }
      heroTransitionTimerRef.current = window.setTimeout(() => {
        setActiveHeroUrl(normalizedNextUrl)
        setIncomingHeroUrl(null)
        heroTransitionTimerRef.current = null
      }, HERO_TRANSITION_MS)
    },
    [character, reduceMotion],
  )

  useEffect(() => {
    if (heroViewMode !== 'latest-activity') return
    const latestActivityImageUrl = readLatestActivityImageUrl(apiActivities)
    transitionToHeroUrl(latestActivityImageUrl ?? heroUrl)
  }, [apiActivities, heroUrl, heroViewMode, transitionToHeroUrl])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setReduceMotion(mediaQuery.matches)
    updatePreference()

    mediaQuery.addEventListener('change', updatePreference)
    return () => {
      mediaQuery.removeEventListener('change', updatePreference)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadRelationships = async () => {
      if (!id) {
        setApiRelationships(null)
        return
      }

      try {
        const response = await fetch(
          `/api/game-objects/${encodeURIComponent(id)}/relationships`,
        )
        if (!response.ok) {
          throw new Error(`API status ${response.status}`)
        }
        const payload = (await response.json()) as { relationships?: ApiRelationship[] }
        if (!cancelled) {
          setApiRelationships(Array.isArray(payload.relationships) ? payload.relationships : [])
        }
      } catch {
        if (!cancelled) {
          setApiRelationships(null)
        }
      }
    }

    void loadRelationships()

    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    const conversationId = searchParams.get('conversationId')?.trim() || ''
    if (!conversationId) return
    setSelectedConversationId(conversationId)
    setIsConversationPanelOpen(true)
  }, [searchParams])

  useEffect(() => {
    let cancelled = false

    const loadConversationDetails = async () => {
      if (!isConversationPanelOpen || !selectedConversationId) {
        setConversationDetails(null)
        setConversationLoading(false)
        setConversationError(null)
        return
      }

      setConversationLoading(true)
      setConversationError(null)
      try {
        const response = await fetch(
          `/api/conversations?conversationId=${encodeURIComponent(selectedConversationId)}`,
        )
        if (!response.ok) {
          throw new Error(`API status ${response.status}`)
        }
        const payload = (await response.json()) as ApiConversationDetails
        if (!cancelled) {
          setConversationDetails(payload)
          setConversationLoading(false)
        }
      } catch {
        if (!cancelled) {
          setConversationError('Conversation konnte nicht geladen werden.')
          setConversationDetails(null)
          setConversationLoading(false)
        }
      }
    }

    void loadConversationDetails()

    return () => {
      cancelled = true
    }
  }, [isConversationPanelOpen, selectedConversationId])

  useEffect(() => {
    if (!id) {
      setActivityStreamConnected(false)
      return
    }

    const streamUrl = `/api/activities/stream?characterId=${encodeURIComponent(id)}&includeNonPublic=true`
    const eventSource = new EventSource(streamUrl)

    const handleReady = () => {
      setActivityStreamConnected(true)
    }

    const handleActivityCreated = (event: MessageEvent<string>) => {
      try {
        const activity = JSON.parse(event.data) as ApiActivityRecord
        if (
          activity.activityType === 'conversation.image.generated' ||
          activity.activityType === 'conversation.image.recalled'
        ) {
          setHeroViewMode('latest-activity')
          transitionToHeroUrl(readActivityImageUrl(activity), {
            memoryOverlay: activity.activityType === 'conversation.image.recalled',
          })
        }
        setApiActivities((current) => {
          const existing = current ?? []
          const withoutDuplicate = existing.filter((item) => item.activityId !== activity.activityId)
          return sortActivitiesDesc([activity, ...withoutDuplicate])
        })
      } catch {
        // ignore invalid stream payloads
      }
    }

    const handleError = () => {
      setActivityStreamConnected(false)
    }

    eventSource.addEventListener('ready', handleReady as EventListener)
    eventSource.addEventListener('activity.created', handleActivityCreated as EventListener)
    eventSource.addEventListener('error', handleError as EventListener)

    return () => {
      eventSource.removeEventListener('ready', handleReady as EventListener)
      eventSource.removeEventListener('activity.created', handleActivityCreated as EventListener)
      eventSource.removeEventListener('error', handleError as EventListener)
      eventSource.close()
      setActivityStreamConnected(false)
    }
  }, [id, transitionToHeroUrl])

  useEffect(() => {
    let cancelled = false

    const loadActivities = async () => {
      if (!id) {
        setApiActivities(null)
        return
      }

      try {
        const collected: ApiActivityRecord[] = []
        for (let page = 0; page < MAX_ACTIVITY_PAGES; page += 1) {
          const offset = page * ACTIVITY_PAGE_SIZE
          const response = await fetch(
            `/api/activities?characterId=${encodeURIComponent(id)}&includeNonPublic=true&limit=${ACTIVITY_PAGE_SIZE}&offset=${offset}`,
          )
          if (!response.ok) {
            throw new Error(`API status ${response.status}`)
          }
          const payload = (await response.json()) as { activities?: ApiActivityRecord[] }
          const pageItems = Array.isArray(payload.activities) ? payload.activities : []
          collected.push(...pageItems)
          if (pageItems.length < ACTIVITY_PAGE_SIZE) {
            break
          }
        }
        if (!cancelled) {
          const dedupedById = new Map<string, ApiActivityRecord>()
          for (const activity of collected) {
            dedupedById.set(activity.activityId, activity)
          }
          setApiActivities(sortActivitiesDesc(Array.from(dedupedById.values())))
        }
      } catch {
        if (!cancelled) {
          setApiActivities(null)
        }
      }
    }

    void loadActivities()

    return () => {
      cancelled = true
    }
  }, [id])

  const relatedCharacters = useMemo(() => {
    if (!character) return []

    const dbRelations = apiRelationships ?? []
    return dbRelations.flatMap((relation) => {
      const relatedCharacterId =
        relation.direction === 'outgoing' ? relation.target.id : relation.source.id
      const relatedCharacter = content.characters.find((candidate) => candidate.id === relatedCharacterId)
      if (!relatedCharacter) return []
      return [
        {
          char: relatedCharacter,
          relationLabel: relation.relationshipTypeReadable || relation.relationship || relation.relationshipType,
        },
      ]
    })
  }, [apiRelationships, character, content.characters])

  const allCharactersById = useMemo(
    () => new Map(content.characters.map((item) => [item.id, { id: item.id, name: item.name }] as const)),
    [content.characters],
  )

  const activityItems = useMemo<CharacterActivityItem[]>(() => {
    if (!character) return []
    if (!apiActivities || apiActivities.length === 0) return []
    const sourceItems = apiActivities.filter((activity) => {
      return shouldShowActivityInPanel({
        activityType: activity.activityType,
        isPublic: activity.isPublic,
        object: activity.object,
        metadata: activity.metadata,
      })
    })

    const resolvedTraceToolCalls = new Set<string>()
    const pendingTraceRequestIds = new Set<string>()
    for (const activity of sourceItems) {
      const traceEvent = parseTraceToolEvent(activity)
      if (!traceEvent) continue
      const callKey = `${activity.conversationId ?? ''}:${traceEvent.toolId}`
      if (traceEvent.kind === 'response' || traceEvent.kind === 'error') {
        resolvedTraceToolCalls.add(callKey)
        continue
      }
      if (traceEvent.kind === 'request' && !resolvedTraceToolCalls.has(callKey)) {
        pendingTraceRequestIds.add(activity.activityId)
      }
    }

    return sourceItems.map((activity) => {
      const subjectLabel = resolveActivitySubjectLabel(activity, character.name)
      const objectLabel =
        readActivityDisplayValue(activity.object) ??
        (activity.activityType === 'conversation.message.created'
          ? character.name
          : activity.activityType === 'conversation.started' ||
              activity.activityType === 'conversation.ended'
            ? 'Conversation'
            : 'Aktivitaet')

      return {
        id: activity.activityId,
        timestamp: activity.occurredAt || activity.createdAt,
        isPublic: activity.isPublic,
        rawActivityType: activity.activityType,
        subject: subjectLabel,
        activityType: activity.activityType,
        object: objectLabel,
        summary: normalizeConversationMessageSummary(
          activity,
          normalizeLegacyCharacterNamesInSummary({
            activity,
            summary:
              readCanonicalStoryText({
                activityType: activity.activityType,
                storySummary: activity.storySummary,
                metadata: activity.metadata,
              }) ?? buildActivitySummary(activity, character.name, subjectLabel, objectLabel),
            characterName: character.name,
            allCharactersById,
          }),
          character.name,
        ),
        summaryCharacters: collectSummaryCharacterLinks({
          activity,
          allCharactersById,
        }),
        conversationId: activity.conversationId,
        conversationUrl: readTextValue(activity.metadata.conversationUrl),
        conversationLabel:
          readTextValue(activity.metadata.conversationLinkLabel) ??
          (activity.conversationId ? 'Conversation ansehen' : undefined),
        imageUrl: normalizeImageUrl(readActivityImageUrl(activity)),
        imageUrls: readAllActivityImageUrls(activity),
        imageLabel: readTextValue(activity.metadata.imageLinkLabel),
        isPending: pendingTraceRequestIds.has(activity.activityId),
      }
    })
  }, [allCharactersById, apiActivities, character])

  const openConversationPanel = useCallback(
    (conversationId: string) => {
      const normalized = conversationId.trim()
      if (!normalized) return
      setSelectedConversationId(normalized)
      setIsConversationPanelOpen(true)
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('conversationId', normalized)
        return next
      })
    },
    [setSearchParams],
  )

  const closeConversationPanel = useCallback(() => {
    setIsConversationPanelOpen(false)
    setSelectedConversationId(null)
    setCopiedConversationText(false)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('conversationId')
      return next
    })
  }, [setSearchParams])

  useEffect(() => {
    return () => {
      if (pointerFrameRef.current != null) {
        window.cancelAnimationFrame(pointerFrameRef.current)
      }
      if (heroTransitionTimerRef.current != null) {
        window.clearTimeout(heroTransitionTimerRef.current)
      }
      if (memoryOverlayTimerRef.current != null) {
        window.clearTimeout(memoryOverlayTimerRef.current)
      }
    }
  }, [])

  const updateHeroParallaxVariables = useCallback(
    (element: HTMLElement, xOffset: number, yOffset: number, glareX: number, glareY: number) => {
      if (pointerFrameRef.current != null) {
        window.cancelAnimationFrame(pointerFrameRef.current)
      }

      pointerFrameRef.current = window.requestAnimationFrame(() => {
        element.style.setProperty('--character-parallax-x', `${xOffset.toFixed(2)}px`)
        element.style.setProperty('--character-parallax-y', `${yOffset.toFixed(2)}px`)
        element.style.setProperty('--character-glare-x', `${glareX.toFixed(2)}%`)
        element.style.setProperty('--character-glare-y', `${glareY.toFixed(2)}%`)
      })
    },
    [],
  )

  const handleHeroMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!isHeroParallaxEnabled) return

      const element = event.currentTarget
      const bounds = element.getBoundingClientRect()
      const normalizedX = (event.clientX - bounds.left) / bounds.width - 0.5
      const normalizedY = (event.clientY - bounds.top) / bounds.height - 0.5

      updateHeroParallaxVariables(
        element,
        normalizedX * -14,
        normalizedY * -10,
        50 + normalizedX * 22,
        44 + normalizedY * 18,
      )
    },
    [isHeroParallaxEnabled, updateHeroParallaxVariables],
  )

  const resetHeroParallax = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    updateHeroParallaxVariables(event.currentTarget, 0, 0, 50, 44)
  }, [updateHeroParallaxVariables])

  const detailStyle = useMemo(() => {
    if (!activeHeroUrl) return undefined
    return {
      '--character-hero-url': `url('${activeHeroUrl}')`,
    } as CSSProperties
  }, [activeHeroUrl])
  const conversationTimelineItems = useMemo(() => {
    if (!selectedConversationId) return []

    const messageItems = (conversationDetails?.messages ?? []).map((message) => {
      const timestampMs = new Date(message.createdAt).getTime()
      return {
        kind: 'message' as const,
        id: `message-${message.messageId}`,
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
        message,
      }
    })

    const eventItems = (apiActivities ?? [])
      .filter((activity) => activity.conversationId === selectedConversationId)
      .map((activity) => ({
        kind: 'activity' as const,
        id: `activity-${activity.activityId}`,
        timestampMs: activityTimeValue(activity),
        activity,
      }))

    return [...messageItems, ...eventItems].sort((a, b) => b.timestampMs - a.timestampMs)
  }, [apiActivities, conversationDetails, selectedConversationId])

  const formatConversationRoleLabel = useCallback(
    (role: ApiConversationMessageRecord['role']): string => {
      if (role === 'user') return FIXED_USER_NAME
      if (role === 'assistant') return character?.name ?? 'Assistant'
      return 'System'
    },
    [character?.name],
  )

  const copyConversationText = useCallback(async () => {
    if (conversationTimelineItems.length === 0) return

    const chronological = conversationTimelineItems.slice().sort((a, b) => a.timestampMs - b.timestampMs)

    const sections: string[] = []

    if (conversationDetails?.conversation.startedAt) {
      sections.push(`Gestartet: ${formatTimestamp(conversationDetails.conversation.startedAt)}`)
    }
    if (conversationDetails?.conversation.endedAt) {
      sections.push(`Beendet: ${formatTimestamp(conversationDetails.conversation.endedAt)}`)
    }

    for (const item of chronological) {
      if (item.kind === 'message') {
        const msg = item.message
        const role = formatConversationRoleLabel(msg.role)
        const time = formatTimestamp(msg.createdAt)
        const content = msg.content.trim()
        if (content) {
          sections.push(`[${role}] (${time})\n${content}`)
        }
      } else {
        const activity = item.activity
        const subjectLabel = resolveActivitySubjectLabel(activity, character?.name ?? '')
        const objectLabel = readActivityDisplayValue(activity.object) ?? 'Aktivitaet'
        const summary = normalizeConversationMessageSummary(
          activity,
          normalizeLegacyCharacterNamesInSummary({
            activity,
            summary:
              readCanonicalStoryText({
                activityType: activity.activityType,
                storySummary: activity.storySummary,
                metadata: activity.metadata,
              }) ?? buildActivitySummary(activity, character?.name ?? '', subjectLabel, objectLabel),
            characterName: character?.name ?? '',
            allCharactersById,
          }),
          character?.name ?? '',
        )
        const time = formatTimestamp(activity.occurredAt || activity.createdAt)
        const isTrace = activity.activityType.startsWith('trace.')
        const parts: string[] = [`[${activity.activityType}] (${time})`]
        if (summary) parts.push(summary)
        if (isTrace) {
          const stage = readTextValue(activity.metadata.traceStage) ?? '-'
          const kind = readTextValue(activity.metadata.traceKind) ?? '-'
          const source = readTextValue(activity.metadata.traceSource) ?? '-'
          parts.push(`${stage} / ${kind} / ${source}`)
        }
        const traceInput = formatTracePayload(activity.metadata.input)
        const traceOutput = formatTracePayload(activity.metadata.output)
        const traceError = readTextValue(activity.metadata.error)
        if (traceInput) parts.push(`Input:\n${traceInput}`)
        if (traceOutput) parts.push(`Output:\n${traceOutput}`)
        if (traceError) parts.push(`Error:\n${traceError}`)
        sections.push(parts.join('\n'))
      }
    }

    const transcriptText = sections.join('\n\n')
    if (!transcriptText) return
    try {
      await navigator.clipboard.writeText(transcriptText)
      setCopiedConversationText(true)
      window.setTimeout(() => {
        setCopiedConversationText(false)
      }, 1200)
    } catch {
      // ignore clipboard errors silently
    }
  }, [conversationTimelineItems, conversationDetails, character?.name, allCharactersById, formatConversationRoleLabel])

  if (!character) {
    return (
      <div className="character-detail-empty">
        <Title level={2}>Charakter nicht gefunden</Title>
        <Button type="primary" onClick={() => navigate('/characters')}>
          Alle Charaktere ansehen
        </Button>
      </div>
    )
  }

  return (
    <div
      className={`character-detail ${
        activeHeroUrl ? 'character-detail-has-hero' : ''
      } ${isHeroParallaxEnabled ? 'character-detail-parallax' : ''} ${
        isMemoryOverlayActive ? 'character-detail-memory-overlay-active' : ''
      }`}
      style={detailStyle}
      onMouseMove={handleHeroMouseMove}
      onMouseLeave={resetHeroParallax}
    >
      <div
        className={`character-detail-hero-transition-layer${incomingHeroUrl ? ' is-visible' : ''}`}
        style={incomingHeroUrl ? { '--character-next-hero-url': `url('${incomingHeroUrl}')` } as CSSProperties : undefined}
        aria-hidden="true"
      />
      <div className="character-detail-memory-overlay" aria-hidden="true" />
      <div className="character-detail-nav">
        <Link to="/characters" className="character-detail-back">
          <ArrowLeftOutlined />
          <span>Charaktere</span>
        </Link>
      </div>

      <div className="character-detail-content">
        <div className="character-detail-info">
          <Text className="character-detail-species">{character.basis.species}</Text>
          <Title level={1} className="character-detail-name">
            <button
              type="button"
              className="character-detail-name-button"
              onClick={() => {
                setHeroViewMode('character-hero')
                transitionToHeroUrl(heroUrl)
              }}
            >
              {character.name}
            </button>
          </Title>
          <Text className="character-detail-description">
            {character.shortDescription}
          </Text>
          <div className="character-detail-traits">
            {character.personality.coreTraits.map((trait) => (
              <Tag key={trait} className="character-detail-trait-tag">
                {trait}
              </Tag>
            ))}
          </div>
          <div className="character-detail-actions">
            <VoiceChatButton character={character} conversationId={selectedConversationId} />
            <Button
              shape="circle"
              size="large"
              className="hero-fav-btn"
              ghost
              icon={<HeartOutlined />}
            />
          </div>

          {relatedCharacters.length > 0 && (
            <div className="character-detail-friends">
              <Text className="character-detail-friends-label">Beziehungen</Text>
              <div className="character-detail-friends-list">
                {relatedCharacters.map(({ char, relationLabel }) => (
                  <Link
                    key={`${char.id}-${relationLabel}`}
                    to={`/characters/${char.id}`}
                    className="character-detail-friend-link"
                  >
                    {char.images.profileImage?.file && (
                      <img
                        src={char.images.profileImage.file}
                        alt={char.name}
                        className="character-detail-friend-avatar"
                      />
                    )}
                    <div className="character-detail-friend-info">
                      <span className="character-detail-friend-name">{char.name}</span>
                      <span className="character-detail-friend-type">{relationLabel}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <CharacterActivityStream
          items={activityItems}
          isLive={activityStreamConnected}
          onOpenConversation={openConversationPanel}
          onSelectImage={(imageUrl, item) =>
            {
              setHeroViewMode('latest-activity')
              transitionToHeroUrl(imageUrl, {
                memoryOverlay:
                  item.rawActivityType === 'conversation.image.recalled' ||
                  item.rawActivityType === 'tool.image.recalled',
              })
            }
          }
        />

      </div>

      <Drawer
        title="Conversation"
        extra={
          selectedConversationId ? (
            <Button
              type="text"
              size="small"
              onClick={() => {
                void copyConversationText()
              }}
              icon={copiedConversationText ? <CheckOutlined /> : <CopyOutlined />}
              disabled={!conversationDetails || conversationDetails.messages.length === 0}
              title={
                copiedConversationText
                  ? 'Conversation-Text kopiert'
                  : 'Gesamten Conversation-Text kopieren'
              }
              aria-label={
                copiedConversationText
                  ? 'Conversation-Text kopiert'
                  : 'Gesamten Conversation-Text in Zwischenablage kopieren'
              }
            />
          ) : null
        }
        placement="right"
        open={isConversationPanelOpen}
        onClose={closeConversationPanel}
        rootClassName="conversation-drawer"
        width={440}
        styles={{
          content: { background: '#000', boxShadow: 'none' },
          header: { background: '#000' },
          body: { background: '#000' },
          mask: { background: 'transparent' },
          wrapper: { background: 'transparent' },
        }}
      >
        {conversationLoading && <p className="conversation-drawer-state">Lade Conversation...</p>}
        {!conversationLoading && conversationError && (
          <p className="conversation-drawer-state conversation-drawer-state-error">{conversationError}</p>
        )}
        {!conversationLoading && !conversationError && conversationDetails && (
          <div className="conversation-drawer-content">
            <p className="conversation-drawer-meta">
              <strong>Gestartet:</strong> {formatTimestamp(conversationDetails.conversation.startedAt)}
            </p>
            {conversationDetails.conversation.endedAt && (
              <p className="conversation-drawer-meta">
                <strong>Beendet:</strong> {formatTimestamp(conversationDetails.conversation.endedAt)}
              </p>
            )}
            <div className="conversation-drawer-messages">
              {conversationTimelineItems.length === 0 ? (
                <p className="conversation-drawer-state">Keine Events gespeichert.</p>
              ) : (
                conversationTimelineItems.map((timelineItem) => {
                  if (timelineItem.kind === 'message') {
                    const message = timelineItem.message
                    const messageImageUrl = normalizeImageUrl(readMessageImageUrl(message))
                    return (
                      <div key={timelineItem.id} className="conversation-drawer-message">
                        <p className="conversation-drawer-message-meta">
                          <span>{formatConversationRoleLabel(message.role)}</span>
                          <span>{formatTimestamp(message.createdAt)}</span>
                        </p>
                        <p className="conversation-drawer-message-content">{message.content}</p>
                        {messageImageUrl && (
                          <button
                            type="button"
                            className="conversation-drawer-image-button"
                            onClick={() => transitionToHeroUrl(messageImageUrl)}
                            aria-label="Bild als Hero-Hintergrund anzeigen"
                          >
                            <img
                              src={messageImageUrl}
                              alt="Generiertes Conversation-Bild"
                              className="conversation-drawer-image"
                            />
                          </button>
                        )}
                      </div>
                    )
                  }

                  const activity = timelineItem.activity
                  const subjectLabel = resolveActivitySubjectLabel(activity, character.name)
                  const objectLabel = readActivityDisplayValue(activity.object) ?? 'Aktivitaet'
                  const summary = normalizeConversationMessageSummary(
                    activity,
                    normalizeLegacyCharacterNamesInSummary({
                      activity,
                      summary:
                        readCanonicalStoryText({
                          activityType: activity.activityType,
                          storySummary: activity.storySummary,
                          metadata: activity.metadata,
                        }) ?? buildActivitySummary(activity, character.name, subjectLabel, objectLabel),
                      characterName: character.name,
                      allCharactersById,
                    }),
                    character.name,
                  )
                  const traceInput = formatTracePayload(activity.metadata.input)
                  const traceOutput = formatTracePayload(activity.metadata.output)
                  const traceError = readTextValue(activity.metadata.error)
                  const traceStage = readTextValue(activity.metadata.traceStage)
                  const traceKind = readTextValue(activity.metadata.traceKind)
                  const traceSource = readTextValue(activity.metadata.traceSource)
                  const isTrace = activity.activityType.startsWith('trace.')
                  return (
                    <div key={timelineItem.id} className="conversation-drawer-message conversation-drawer-event">
                      <p className="conversation-drawer-message-meta">
                        <span>{activity.activityType}</span>
                        <span>{formatTimestamp(activity.occurredAt || activity.createdAt)}</span>
                      </p>
                      <p className="conversation-drawer-message-content">{summary}</p>
                      {isTrace ? (
                        <p className="conversation-drawer-trace-meta">
                          {traceStage ?? '-'} / {traceKind ?? '-'} / {traceSource ?? '-'}
                        </p>
                      ) : null}
                      {traceInput ? (
                        <div className="conversation-drawer-trace-block">
                          <p className="conversation-drawer-trace-label">Input</p>
                          <pre className="conversation-drawer-trace-pre">{traceInput}</pre>
                        </div>
                      ) : null}
                      {traceOutput ? (
                        <div className="conversation-drawer-trace-block">
                          <p className="conversation-drawer-trace-label">Output</p>
                          <pre className="conversation-drawer-trace-pre">{traceOutput}</pre>
                        </div>
                      ) : null}
                      {traceError ? (
                        <div className="conversation-drawer-trace-block">
                          <p className="conversation-drawer-trace-label">Error</p>
                          <pre className="conversation-drawer-trace-pre">{traceError}</pre>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
