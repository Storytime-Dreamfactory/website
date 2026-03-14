import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { StoryContent } from './content/types'
import type { CharacterActivityItem } from './activityPanelTypes'
import { readCanonicalStoryText } from './storyText'
import { warmImageCacheInBackground } from './imageDeliveryService'
import {
  type ApiRelationship,
  type ApiActivityRecord,
  type ApiConversationDetails,
  type ApiConversationMessageRecord,
  type HeroViewMode,
  HERO_TRANSITION_MS,
  MEMORY_OVERLAY_MS,
  MEMORY_OVERLAY_CHARACTER_IDS,
  FIXED_USER_NAME,
  readTextValue,
  readActivityDisplayValue,
  resolveActivitySubjectLabel,
  normalizeConversationMessageSummary,
  normalizeLegacyCharacterNamesInSummary,
  readActivityImageUrl,
  readAllActivityImageUrls,
  normalizeImageUrl,
  readLatestActivityImageUrl,
  parseTraceToolEvent,
  collectSummaryCharacterLinks,
  buildActivitySummary,
  activityTimeValue,
  sortActivitiesDesc,
  formatTimestamp,
  formatTracePayload,
} from './characterTypes'

type UseCharacterDataOptions = {
  content: StoryContent
  loadActivities?: boolean
}

const HERO_IMAGE_CACHE_PREFIX = 'story:lastHeroImage:'
const ACTIVITY_CACHE_PREFIX = 'story:activityFeed:'
const CONVERSATION_CACHE_PREFIX = 'story:conversationDetails:'
const DEFAULT_CONVERSATION_LINK_LABEL = 'View Full Conversation'
const ACTIVITY_UI_PAGE_SIZE = 10
const ACTIVITY_INITIAL_PREFETCH_PAGES = 2
const ACTIVITY_FETCH_PAGE_SIZE = 500

const getHeroImageCacheKey = (characterId: string): string => `${HERO_IMAGE_CACHE_PREFIX}${characterId}`
const getActivityCacheKey = (characterId: string): string => `${ACTIVITY_CACHE_PREFIX}${characterId}`
const getConversationCacheKey = (conversationId: string): string => `${CONVERSATION_CACHE_PREFIX}${conversationId}`
const buildConversationUrl = (characterId: string, conversationId: string): string =>
  `/characters/${encodeURIComponent(characterId)}/story?conversationId=${encodeURIComponent(conversationId)}`

const readCachedHeroUrl = (characterId: string): string | null => {
  if (typeof window === 'undefined') return null
  try {
    const value = window.sessionStorage.getItem(getHeroImageCacheKey(characterId))
    return normalizeImageUrl(value ?? undefined) ?? null
  } catch {
    return null
  }
}

const writeCachedHeroUrl = (characterId: string, imageUrl: string): void => {
  if (typeof window === 'undefined') return
  const normalized = normalizeImageUrl(imageUrl)
  if (!normalized) return
  try {
    window.sessionStorage.setItem(getHeroImageCacheKey(characterId), normalized)
  } catch {
    // ignore storage errors silently
  }
}

const clearCachedHeroUrl = (characterId: string): void => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(getHeroImageCacheKey(characterId))
  } catch {
    // ignore storage errors silently
  }
}

const preloadImage = async (imageUrl: string): Promise<boolean> => {
  if (typeof window === 'undefined') return false
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = imageUrl
  })
}

const readCachedActivities = (characterId: string): ApiActivityRecord[] | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(getActivityCacheKey(characterId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { activities?: ApiActivityRecord[] } | null
    return Array.isArray(parsed?.activities) ? sortActivitiesDesc(parsed.activities) : null
  } catch {
    return null
  }
}

const writeCachedActivities = (characterId: string, activities: ApiActivityRecord[]): void => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      getActivityCacheKey(characterId),
      JSON.stringify({ activities: sortActivitiesDesc(activities) }),
    )
  } catch {
    // ignore storage errors silently
  }
}

const readCachedConversationDetails = (conversationId: string): ApiConversationDetails | null => {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(getConversationCacheKey(conversationId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as ApiConversationDetails | null
    if (!parsed?.conversation || !Array.isArray(parsed.messages)) return null
    return parsed
  } catch {
    return null
  }
}

const writeCachedConversationDetails = (
  conversationId: string,
  details: ApiConversationDetails,
): void => {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(getConversationCacheKey(conversationId), JSON.stringify(details))
  } catch {
    // ignore storage errors silently
  }
}

export default function useCharacterData({ content, loadActivities = false }: UseCharacterDataOptions) {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [reduceMotion, setReduceMotion] = useState(false)
  const pointerFrameRef = useRef<number | null>(null)
  const [apiRelationships, setApiRelationships] = useState<ApiRelationship[] | null>(null)
  const [apiActivities, setApiActivities] = useState<ApiActivityRecord[] | null>(null)
  const [hasMoreActivities, setHasMoreActivities] = useState(false)
  const [activityLoadMorePending, setActivityLoadMorePending] = useState(false)
  const [activityStreamConnected, setActivityStreamConnected] = useState(false)
  const [isConversationPanelOpen, setIsConversationPanelOpen] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [conversationDetails, setConversationDetails] = useState<ApiConversationDetails | null>(null)
  const [conversationActivities, setConversationActivities] = useState<ApiActivityRecord[] | null>(null)
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
  const incomingHeroUrlRef = useRef<string | null>(null)
  const isFirstHeroResolveRef = useRef(true)
  const nextActivityOffsetRef = useRef(0)
  const hasMoreActivitiesRef = useRef(false)
  const activityLoadMoreInFlightRef = useRef(false)

  const character = useMemo(
    () => content.characters.find((c) => c.id === id),
    [content.characters, id],
  )
  const heroUrl = character?.images.heroImage?.file
  const isHeroParallaxEnabled = Boolean(activeHeroUrl) && !reduceMotion

  const applyHeroUrlImmediately = useCallback((nextUrl: string | undefined) => {
    const normalizedNextUrl = normalizeImageUrl(nextUrl)
    if (heroTransitionTimerRef.current != null) {
      window.clearTimeout(heroTransitionTimerRef.current)
      heroTransitionTimerRef.current = null
    }
    setIncomingHeroUrl(null)
    incomingHeroUrlRef.current = null
    setActiveHeroUrl(normalizedNextUrl)
    activeHeroUrlRef.current = normalizedNextUrl
  }, [])

  useEffect(() => {
    setHeroViewMode('latest-activity')
    isFirstHeroResolveRef.current = true

    const normalizedHeroUrl = normalizeImageUrl(heroUrl)
    if (!character?.id || !loadActivities) {
      applyHeroUrlImmediately(normalizedHeroUrl)
      return
    }

    const cachedHeroUrl = readCachedHeroUrl(character.id)
    if (!cachedHeroUrl) {
      warmImageCacheInBackground([normalizedHeroUrl])
      applyHeroUrlImmediately(normalizedHeroUrl)
      return
    }

    warmImageCacheInBackground([cachedHeroUrl, normalizedHeroUrl])
    applyHeroUrlImmediately(cachedHeroUrl)

    void preloadImage(cachedHeroUrl).then((isValid) => {
      if (isValid) return
      if (activeHeroUrlRef.current === cachedHeroUrl) {
        applyHeroUrlImmediately(normalizedHeroUrl)
      }
      clearCachedHeroUrl(character.id)
    })
  }, [heroUrl, character?.id, loadActivities, applyHeroUrlImmediately])

  useEffect(() => {
    activeHeroUrlRef.current = activeHeroUrl
  }, [activeHeroUrl])

  useEffect(() => {
    incomingHeroUrlRef.current = incomingHeroUrl
  }, [incomingHeroUrl])

  const transitionToHeroUrl = useCallback(
    (nextUrl: string | undefined, options?: { memoryOverlay?: boolean; persistToCache?: boolean }) => {
      const normalizedNextUrl = normalizeImageUrl(nextUrl)
      if (!normalizedNextUrl) return

      const isAlreadyActive = normalizedNextUrl === activeHeroUrlRef.current
      const isAlreadyIncoming = normalizedNextUrl === incomingHeroUrlRef.current
      const transitionInProgress = heroTransitionTimerRef.current != null

      if (isAlreadyActive && !transitionInProgress) return
      if (isAlreadyIncoming) return

      if (!isAlreadyActive && options?.memoryOverlay && character && MEMORY_OVERLAY_CHARACTER_IDS.has(character.id)) {
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

      if (transitionInProgress) {
        window.clearTimeout(heroTransitionTimerRef.current!)
        heroTransitionTimerRef.current = null

        if (isAlreadyActive) {
          setIncomingHeroUrl(null)
          incomingHeroUrlRef.current = null
          return
        }

        const pendingUrl = incomingHeroUrlRef.current
        if (pendingUrl) {
          setActiveHeroUrl(pendingUrl)
          activeHeroUrlRef.current = pendingUrl
          setIncomingHeroUrl(null)
          incomingHeroUrlRef.current = null
        }
      }

      if (normalizedNextUrl === activeHeroUrlRef.current) return

      if (options?.persistToCache && character?.id) {
        writeCachedHeroUrl(character.id, normalizedNextUrl)
      }

      warmImageCacheInBackground([normalizedNextUrl])

      setIncomingHeroUrl(normalizedNextUrl)
      heroTransitionTimerRef.current = window.setTimeout(() => {
        setActiveHeroUrl(normalizedNextUrl)
        setIncomingHeroUrl(null)
        heroTransitionTimerRef.current = null
      }, HERO_TRANSITION_MS)
    },
    [character, reduceMotion],
  )

  useEffect(() => {
    if (!loadActivities) return
    if (heroViewMode !== 'latest-activity') return
    if (apiActivities == null) return

    const latestActivityImageUrl = normalizeImageUrl(readLatestActivityImageUrl(apiActivities))
    if (!latestActivityImageUrl) {
      if (character?.id) {
        clearCachedHeroUrl(character.id)
      }
      transitionToHeroUrl(heroUrl)
      return
    }

    if (character?.id) {
      writeCachedHeroUrl(character.id, latestActivityImageUrl)
    }

    if (isFirstHeroResolveRef.current) {
      isFirstHeroResolveRef.current = false
      applyHeroUrlImmediately(latestActivityImageUrl)
      return
    }

    transitionToHeroUrl(latestActivityImageUrl)
  }, [
    apiActivities,
    heroUrl,
    heroViewMode,
    loadActivities,
    transitionToHeroUrl,
    character?.id,
    applyHeroUrlImmediately,
  ])

  useEffect(() => {
    if (!apiActivities || apiActivities.length === 0) return
    const urls: string[] = []
    for (const activity of apiActivities) {
      urls.push(...readAllActivityImageUrls(activity))
    }
    warmImageCacheInBackground(urls)
  }, [apiActivities])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
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
    if (!loadActivities) return
    if (!id) return

    const cachedActivities = readCachedActivities(id)
    if (cachedActivities && cachedActivities.length > 0) {
      setApiActivities(cachedActivities)
    }
  }, [loadActivities, id])

  const fetchConversationActivities = useCallback(
    async (conversationId: string): Promise<ApiActivityRecord[]> => {
      const collected: ApiActivityRecord[] = []
      let offset = 0

      while (true) {
        const response = await fetch(
          `/api/activities?conversationId=${encodeURIComponent(conversationId)}&includeNonPublic=true&limit=${ACTIVITY_FETCH_PAGE_SIZE}&offset=${offset}`,
        )
        if (!response.ok) {
          throw new Error(`API status ${response.status}`)
        }
        const payload = (await response.json()) as { activities?: ApiActivityRecord[] }
        const pageItems = Array.isArray(payload.activities) ? payload.activities : []
        collected.push(...pageItems)

        if (pageItems.length < ACTIVITY_FETCH_PAGE_SIZE) {
          break
        }
        offset += ACTIVITY_FETCH_PAGE_SIZE
      }

      return sortActivitiesDesc(collected)
    },
    [],
  )

  const fetchLatestConversationDetails = useCallback(async (): Promise<ApiConversationDetails | null> => {
    if (!id) return null
    const response = await fetch(
      `/api/conversations/latest?characterId=${encodeURIComponent(id)}`,
    )
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`API status ${response.status}`)
    }
    return (await response.json()) as ApiConversationDetails
  }, [id])

  useEffect(() => {
    if (!loadActivities) return

    let cancelled = false

    const loadConversationPanelData = async () => {
      if (!isConversationPanelOpen || !selectedConversationId) {
        setConversationDetails(null)
        setConversationActivities(null)
        setConversationLoading(false)
        setConversationError(null)
        return
      }

      setConversationLoading(true)
      setConversationError(null)
      const previewItems = sortActivitiesDesc(
        (apiActivities ?? []).filter((activity) => activity.conversationId === selectedConversationId),
      )
      setConversationActivities(previewItems)

      const cachedDetails = readCachedConversationDetails(selectedConversationId)
      if (cachedDetails) {
        setConversationDetails(cachedDetails)
      }
      try {
        const [conversationResponse, fullConversationActivities] = await Promise.all([
          fetch(
            `/api/conversations?conversationId=${encodeURIComponent(selectedConversationId)}`,
          ),
          fetchConversationActivities(selectedConversationId),
        ])
        if (!conversationResponse.ok) {
          throw new Error(`API status ${conversationResponse.status}`)
        }
        const payload = (await conversationResponse.json()) as ApiConversationDetails
        if (!cancelled) {
          setConversationDetails(payload)
          setConversationActivities(fullConversationActivities)
          writeCachedConversationDetails(selectedConversationId, payload)
          setConversationLoading(false)
        }
      } catch {
        try {
          const latestDetails = await fetchLatestConversationDetails()
          const latestConversationId = latestDetails?.conversation.conversationId?.trim() ?? ''
          if (latestDetails && latestConversationId && latestConversationId !== selectedConversationId) {
            const latestConversationActivities = await fetchConversationActivities(latestConversationId)
            if (!cancelled) {
              setSelectedConversationId(latestConversationId)
              setConversationDetails(latestDetails)
              setConversationActivities(latestConversationActivities)
              writeCachedConversationDetails(latestConversationId, latestDetails)
              setConversationError(null)
              setConversationLoading(false)
              setSearchParams((current) => {
                const next = new URLSearchParams(current)
                next.set('conversationId', latestConversationId)
                return next
              })
            }
            return
          }
        } catch {
          // fall through to generic UI error
        }
        if (!cancelled) {
          setConversationError('Conversation konnte nicht geladen werden.')
          setConversationDetails(null)
          setConversationActivities(null)
          setConversationLoading(false)
        }
      }
    }

    void loadConversationPanelData()

    return () => {
      cancelled = true
    }
  }, [
    loadActivities,
    isConversationPanelOpen,
    selectedConversationId,
    apiActivities,
    fetchConversationActivities,
    fetchLatestConversationDetails,
    setSearchParams,
  ])

  const mergeActivities = useCallback(
    (incoming: ApiActivityRecord[]) => {
      setApiActivities((current) => {
        const combined = [...(current ?? []), ...incoming]
        const dedupedById = new Map<string, ApiActivityRecord>()
        for (const activity of combined) {
          dedupedById.set(activity.activityId, activity)
        }
        const next = sortActivitiesDesc(Array.from(dedupedById.values()))
        if (id) {
          writeCachedActivities(id, next)
        }
        return next
      })
    },
    [id],
  )

  const fetchActivityPage = useCallback(async (characterId: string, offset: number): Promise<ApiActivityRecord[]> => {
    const response = await fetch(
      `/api/activities?characterId=${encodeURIComponent(characterId)}&includeNonPublic=false&limit=${ACTIVITY_UI_PAGE_SIZE}&offset=${offset}`,
    )
    if (!response.ok) {
      throw new Error(`API status ${response.status}`)
    }
    const payload = (await response.json()) as { activities?: ApiActivityRecord[] }
    return Array.isArray(payload.activities) ? payload.activities : []
  }, [])

  const loadMoreActivities = useCallback(async () => {
    if (!loadActivities || !id) return
    if (!hasMoreActivitiesRef.current) return
    if (activityLoadMoreInFlightRef.current) return

    activityLoadMoreInFlightRef.current = true
    setActivityLoadMorePending(true)
    try {
      const offset = nextActivityOffsetRef.current
      const pageItems = await fetchActivityPage(id, offset)
      if (pageItems.length > 0) {
        mergeActivities(pageItems)
      }

      nextActivityOffsetRef.current += ACTIVITY_UI_PAGE_SIZE

      const hasMore = pageItems.length === ACTIVITY_UI_PAGE_SIZE
      hasMoreActivitiesRef.current = hasMore
      setHasMoreActivities(hasMore)
    } catch {
      // keep previous pagination state on transient failures
    } finally {
      activityLoadMoreInFlightRef.current = false
      setActivityLoadMorePending(false)
    }
  }, [fetchActivityPage, id, loadActivities, mergeActivities])

  useEffect(() => {
    if (!loadActivities || !id) {
      setActivityStreamConnected(false)
      return
    }
    if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
      setActivityStreamConnected(false)
      return
    }

    const streamUrl = `/api/activities/stream?characterId=${encodeURIComponent(id)}&includeNonPublic=false`
    const eventSource = new window.EventSource(streamUrl)

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
          const activityImageUrl = normalizeImageUrl(readActivityImageUrl(activity))
          if (character?.id && activityImageUrl) {
            writeCachedHeroUrl(character.id, activityImageUrl)
          }
          setHeroViewMode('latest-activity')
          transitionToHeroUrl(activityImageUrl ?? undefined, {
            memoryOverlay: activity.activityType === 'conversation.image.recalled',
          })
        }
        mergeActivities([activity])
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
  }, [loadActivities, id, transitionToHeroUrl, character?.id, mergeActivities])

  useEffect(() => {
    if (!loadActivities) return

    let cancelled = false

    const fetchActivities = async () => {
      if (!id) {
        setApiActivities(null)
        setHasMoreActivities(false)
        return
      }

      nextActivityOffsetRef.current = 0
      hasMoreActivitiesRef.current = false
      activityLoadMoreInFlightRef.current = false
      setActivityLoadMorePending(false)

      try {
        const collected: ApiActivityRecord[] = []
        let hasMore = true
        let nextOffset = 0

        for (let page = 0; page < ACTIVITY_INITIAL_PREFETCH_PAGES; page += 1) {
          const pageItems = await fetchActivityPage(id, nextOffset)
          collected.push(...pageItems)
          nextOffset += ACTIVITY_UI_PAGE_SIZE
          if (pageItems.length < ACTIVITY_UI_PAGE_SIZE) {
            hasMore = false
            break
          }
        }

        if (!cancelled) {
          const dedupedById = new Map<string, ApiActivityRecord>()
          for (const activity of collected) {
            dedupedById.set(activity.activityId, activity)
          }
          const nextActivities = sortActivitiesDesc(Array.from(dedupedById.values()))
          setApiActivities(nextActivities)
          writeCachedActivities(id, nextActivities)
          nextActivityOffsetRef.current = nextOffset
          hasMoreActivitiesRef.current = hasMore
          setHasMoreActivities(hasMore)
        }
      } catch {
        if (!cancelled) {
          const cachedActivities = readCachedActivities(id)
          const preloadCount = ACTIVITY_UI_PAGE_SIZE * ACTIVITY_INITIAL_PREFETCH_PAGES
          const limitedCachedActivities = cachedActivities?.slice(0, preloadCount) ?? null
          setApiActivities(limitedCachedActivities)
          const cachedCount = limitedCachedActivities?.length ?? 0
          const hasMore = cachedCount >= ACTIVITY_UI_PAGE_SIZE * ACTIVITY_INITIAL_PREFETCH_PAGES
          nextActivityOffsetRef.current = cachedCount
          hasMoreActivitiesRef.current = hasMore
          setHasMoreActivities(hasMore)
        }
      }
    }

    void fetchActivities()

    return () => {
      cancelled = true
    }
  }, [loadActivities, id, fetchActivityPage])

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
    if (!loadActivities || !character) return []
    if (!apiActivities || apiActivities.length === 0) return []
    const sourceItems = apiActivities

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

      const conversationId = readTextValue(activity.conversationId)
      const conversationUrlFromMetadata = readTextValue(activity.metadata.conversationUrl)
      const conversationUrl =
        conversationUrlFromMetadata ??
        (conversationId && character?.id
          ? buildConversationUrl(character.id, conversationId)
          : undefined)
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
        conversationId,
        conversationUrl,
        conversationLabel:
          readTextValue(activity.metadata.conversationLinkLabel) ??
          (conversationId ? DEFAULT_CONVERSATION_LINK_LABEL : undefined),
        imageUrl: normalizeImageUrl(readActivityImageUrl(activity)),
        imageUrls: readAllActivityImageUrls(activity),
        imageLabel: readTextValue(activity.metadata.imageLinkLabel),
        isPending: pendingTraceRequestIds.has(activity.activityId),
      }
    })
  }, [allCharactersById, apiActivities, character, loadActivities])

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
    if (!loadActivities || !selectedConversationId) return []

    const messageItems = (conversationDetails?.messages ?? []).map((message) => {
      const timestampMs = new Date(message.createdAt).getTime()
      return {
        kind: 'message' as const,
        id: `message-${message.messageId}`,
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
        message,
      }
    })

    const eventItems = (conversationActivities ?? [])
      .filter((activity) => activity.conversationId === selectedConversationId)
      .map((activity) => ({
        kind: 'activity' as const,
        id: `activity-${activity.activityId}`,
        timestampMs: activityTimeValue(activity),
        activity,
      }))

    return [...messageItems, ...eventItems].sort((a, b) => b.timestampMs - a.timestampMs)
  }, [conversationActivities, conversationDetails, loadActivities, selectedConversationId])

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
        const msgContent = msg.content.trim()
        if (msgContent) {
          sections.push(`[${role}] (${time})\n${msgContent}`)
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

  return {
    id,
    navigate,
    character,
    heroUrl,
    relatedCharacters,
    allCharactersById,

    activeHeroUrl,
    incomingHeroUrl,
    isMemoryOverlayActive,
    isHeroParallaxEnabled,
    detailStyle,
    transitionToHeroUrl,
    handleHeroMouseMove,
    resetHeroParallax,
    setHeroViewMode,

    activityItems,
    activityStreamConnected,
    hasMoreActivities,
    activityLoadMorePending,
    loadMoreActivities,
    apiActivities,

    selectedConversationId,
    isConversationPanelOpen,
    openConversationPanel,
    closeConversationPanel,
    conversationDetails,
    conversationLoading,
    conversationError,
    conversationTimelineItems,
    copiedConversationText,
    copyConversationText,
    formatConversationRoleLabel,
  }
}
