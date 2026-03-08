import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import { Button, Drawer, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, HeartOutlined } from '@ant-design/icons'
import type { StoryContent } from './content/types'
import VoiceChatButton from './VoiceChatButton'
import CharacterActivityStream, { type CharacterActivityItem } from './CharacterActivityStream'

const { Title, Text } = Typography

type Props = {
  content: StoryContent
}

type ApiRelationship = {
  sourceCharacterId: string
  targetCharacterId: string
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
  occurredAt: string
  createdAt: string
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

const HERO_TRANSITION_MS = 1100

const readTextValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const readActivityDisplayValue = (value: ApiActivityData | undefined): string | undefined =>
  readTextValue(value?.text) ??
  readTextValue(value?.name) ??
  readTextValue(value?.label) ??
  readTextValue(value?.title) ??
  readTextValue(value?.id)

const readActivityImageUrl = (activity: ApiActivityRecord): string | undefined =>
  readTextValue(activity.metadata.heroImageUrl) ??
  readTextValue(activity.metadata.imageLinkUrl) ??
  readTextValue(activity.metadata.imageUrl) ??
  readTextValue(activity.object.url)

const readMessageImageUrl = (message: ApiConversationMessageRecord): string | undefined => {
  const metadata = message.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined
  }
  return readTextValue(metadata.heroImageUrl) ?? readTextValue(metadata.imageUrl)
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

const humanizeActivityType = (activityType: string): string => {
  switch (activityType) {
    case 'character.chat.completed':
      return 'sprach mit'
    case 'conversation.image.generated':
      return 'zeigte ein Bild'
    case 'conversation.message.created':
      return 'sendete eine Nachricht'
    case 'conversation.started':
      return 'startete eine Unterhaltung'
    case 'conversation.learning_goal.activated':
      return 'aktivierte ein Lernziel'
    case 'conversation.ended':
      return 'beendete eine Unterhaltung'
    case 'skill.visual-expression.started':
      return 'startete visuelles Erklaeren'
    case 'skill.visual-expression.completed':
      return 'beendete visuelles Erklaeren'
    case 'skill.quiz.started':
      return 'startete ein Quiz'
    case 'skill.quiz.completed':
      return 'beendete ein Quiz'
    case 'tool.image.planning.started':
      return 'plant ein Bild'
    case 'tool.image.requested':
      return 'startete die Bildgenerierung'
    case 'tool.image.generating':
      return 'erstellt gerade ein Bild'
    case 'tool.image.generated':
      return 'hat ein Bild fertiggestellt'
    case 'tool.image.failed':
      return 'konnte kein Bild erstellen'
    default:
      return activityType.replaceAll('.', ' ')
  }
}

const buildActivitySummary = (activity: ApiActivityRecord, characterName: string): string => {
  const metadataSummary = readTextValue(activity.metadata.summary)
  if (metadataSummary) return metadataSummary

  const subjectLabel = readActivityDisplayValue(activity.subject) ?? characterName
  const objectLabel = readActivityDisplayValue(activity.object)
  const activityLabel = humanizeActivityType(activity.activityType)

  if (objectLabel) {
    return `${subjectLabel} ${activityLabel} ${objectLabel}`
  }

  return `${subjectLabel} ${activityLabel}`
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
  const [activeHeroUrl, setActiveHeroUrl] = useState<string | undefined>(undefined)
  const [incomingHeroUrl, setIncomingHeroUrl] = useState<string | null>(null)
  const heroTransitionTimerRef = useRef<number | null>(null)
  const activeHeroUrlRef = useRef<string | undefined>(undefined)

  const character = useMemo(
    () => content.characters.find((c) => c.id === id),
    [content.characters, id],
  )
  const heroUrl = character?.images.heroImage?.file
  const isHeroParallaxEnabled = Boolean(activeHeroUrl) && !reduceMotion

  useEffect(() => {
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
    (nextUrl: string | undefined) => {
      const normalizedNextUrl = nextUrl?.trim()
      if (!normalizedNextUrl || normalizedNextUrl === activeHeroUrlRef.current) return

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
    [reduceMotion],
  )

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
        const response = await fetch(`/api/relationships/?characterId=${encodeURIComponent(id)}`)
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
        if (activity.activityType === 'conversation.image.generated') {
          transitionToHeroUrl(readActivityImageUrl(activity))
        }
        setApiActivities((current) => {
          const existing = current ?? []
          const withoutDuplicate = existing.filter((item) => item.activityId !== activity.activityId)
          return [activity, ...withoutDuplicate].slice(0, 12)
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
        const response = await fetch(
          `/api/activities?characterId=${encodeURIComponent(id)}&includeNonPublic=true&limit=12`,
        )
        if (!response.ok) {
          throw new Error(`API status ${response.status}`)
        }
        const payload = (await response.json()) as { activities?: ApiActivityRecord[] }
        if (!cancelled) {
          setApiActivities(Array.isArray(payload.activities) ? payload.activities : [])
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
    if (dbRelations.length > 0) {
      return dbRelations.flatMap((relation) => {
        const relatedCharacterId =
          relation.direction === 'outgoing' ? relation.targetCharacterId : relation.sourceCharacterId
        const relatedCharacter = content.characters.find((candidate) => candidate.id === relatedCharacterId)
        if (!relatedCharacter) return []

        return [
          {
            char: relatedCharacter,
            relationLabel: relation.relationshipTypeReadable || relation.relationship || relation.relationshipType,
            directionLabel: relation.direction === 'outgoing' ? 'zu' : 'von',
          },
        ]
      })
    }

    const fallbackRelations = character.relationships?.characters ?? []
    return fallbackRelations.flatMap((relation) => {
      const relatedCharacter = content.characters.find((candidate) => candidate.id === relation.characterId)
      if (!relatedCharacter) return []
      return [{ char: relatedCharacter, relationLabel: relation.type, directionLabel: 'zu' }]
    })
  }, [apiRelationships, character, content.characters])

  const activityItems = useMemo<CharacterActivityItem[]>(() => {
    if (!character) return []
    if (!apiActivities || apiActivities.length === 0) return []

    return apiActivities.map((activity) => ({
      id: activity.activityId,
      timestamp: activity.occurredAt || activity.createdAt,
      isPublic: activity.isPublic,
      subject: readActivityDisplayValue(activity.subject) ?? character.name,
      activityType: humanizeActivityType(activity.activityType),
      object: readActivityDisplayValue(activity.object) ?? 'Aktivitaet',
      summary: buildActivitySummary(activity, character.name),
      conversationId: activity.conversationId,
      conversationUrl: readTextValue(activity.metadata.conversationUrl),
      conversationLabel: readTextValue(activity.metadata.conversationLinkLabel),
      imageUrl: readTextValue(activity.metadata.imageLinkUrl) ?? readActivityImageUrl(activity),
      imageLabel: readTextValue(activity.metadata.imageLinkLabel),
      imagePrompt: readTextValue(activity.metadata.imageGenerationPrompt),
    }))
  }, [apiActivities, character])

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
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('conversationId')
      return next
    })
  }, [setSearchParams])

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

  useEffect(() => {
    return () => {
      if (pointerFrameRef.current != null) {
        window.cancelAnimationFrame(pointerFrameRef.current)
      }
      if (heroTransitionTimerRef.current != null) {
        window.clearTimeout(heroTransitionTimerRef.current)
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

  return (
    <div
      className={`character-detail ${
        activeHeroUrl ? 'character-detail-has-hero' : ''
      } ${isHeroParallaxEnabled ? 'character-detail-parallax' : ''}`}
      style={detailStyle}
      onMouseMove={handleHeroMouseMove}
      onMouseLeave={resetHeroParallax}
    >
      {incomingHeroUrl ? (
        <div
          className="character-detail-hero-transition-layer is-visible"
          style={{ '--character-next-hero-url': `url('${incomingHeroUrl}')` } as CSSProperties}
          aria-hidden="true"
        />
      ) : null}
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
            {character.name}
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
            <VoiceChatButton character={character} />
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
                {relatedCharacters.map(({ char, relationLabel, directionLabel }) => (
                  <Link
                    key={`${char.id}-${relationLabel}-${directionLabel}`}
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
                      <span className="character-detail-friend-type">
                        {directionLabel}: {relationLabel}
                      </span>
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
          onSelectImage={transitionToHeroUrl}
        />

      </div>

      <Drawer
        title="Conversation"
        placement="right"
        open={isConversationPanelOpen}
        onClose={closeConversationPanel}
        className="conversation-drawer"
        width={420}
        styles={{
          content: { background: 'rgba(0, 0, 0, 0.92)', color: 'rgba(255, 255, 255, 0.88)' },
          header: { background: 'rgba(0, 0, 0, 0.92)', color: 'rgba(255, 255, 255, 0.88)' },
          body: { background: 'rgba(0, 0, 0, 0.92)', color: 'rgba(255, 255, 255, 0.88)' },
          mask: { background: 'rgba(0, 0, 0, 0.22)' },
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
              {conversationDetails.messages.length === 0 ? (
                <p className="conversation-drawer-state">Keine Messages gespeichert.</p>
              ) : (
                conversationDetails.messages.map((message) => {
                  const messageImageUrl = readMessageImageUrl(message)
                  return (
                    <div key={message.messageId} className="conversation-drawer-message">
                      <p className="conversation-drawer-message-meta">
                        <span>{message.role}</span>
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
                })
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
