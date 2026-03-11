import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import type { StoryContent } from './content/types'
import type { CharacterActivityItem } from './CharacterActivityStream'
import { shouldShowActivityInPanel } from './activityPanelVisibility'
import { readCanonicalStoryText } from './storyText'
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
  ACTIVITY_PAGE_SIZE,
  MAX_ACTIVITY_PAGES,
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
  readMessageImageUrl,
  formatTracePayload,
} from './characterTypes'

type UseCharacterDataOptions = {
  content: StoryContent
  loadActivities?: boolean
}

export default function useCharacterData({ content, loadActivities = false }: UseCharacterDataOptions) {
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
  const incomingHeroUrlRef = useRef<string | null>(null)

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

  useEffect(() => {
    incomingHeroUrlRef.current = incomingHeroUrl
  }, [incomingHeroUrl])

  const transitionToHeroUrl = useCallback(
    (nextUrl: string | undefined, options?: { memoryOverlay?: boolean }) => {
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
    const latestActivityImageUrl = readLatestActivityImageUrl(apiActivities)
    transitionToHeroUrl(latestActivityImageUrl ?? heroUrl)
  }, [apiActivities, heroUrl, heroViewMode, loadActivities, transitionToHeroUrl])

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
    if (!loadActivities) return

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
  }, [loadActivities, isConversationPanelOpen, selectedConversationId])

  useEffect(() => {
    if (!loadActivities || !id) {
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
  }, [loadActivities, id, transitionToHeroUrl])

  useEffect(() => {
    if (!loadActivities) return

    let cancelled = false

    const fetchActivities = async () => {
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

    void fetchActivities()

    return () => {
      cancelled = true
    }
  }, [loadActivities, id])

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

    const eventItems = (apiActivities ?? [])
      .filter((activity) => activity.conversationId === selectedConversationId)
      .map((activity) => ({
        kind: 'activity' as const,
        id: `activity-${activity.activityId}`,
        timestampMs: activityTimeValue(activity),
        activity,
      }))

    return [...messageItems, ...eventItems].sort((a, b) => b.timestampMs - a.timestampMs)
  }, [apiActivities, conversationDetails, loadActivities, selectedConversationId])

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
