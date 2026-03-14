import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  Alert,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Divider,
  Input,
  Layout,
  Menu,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd'
import { ArrowLeftOutlined, AudioOutlined, CloseOutlined, HeartOutlined } from '@ant-design/icons'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import storytimeLogo from './assets/storytime-logo.png'
import userProfileAvatar from './assets/user-profile-avatar.png'
import CharacterDetailPage from './CharacterDetailPage'
import CharacterStoryPage from './CharacterStoryPage'
import CreateCharacterPage from './CreateCharacterPage'
import MapPage from './MapPage'
import LearningGoalsPage from './LearningGoalsPage'
import GameObjectCard, {
  type GameObjectKind,
  type GameObjectProperty,
  type GameObjectRelationship,
} from './design-system/gameObjects/GameObjectCard'
import RelationshipPill from './design-system/gameObjects/RelationshipPill'
import { loadStoryContent } from './content/loaders'
import type { StoryContent } from './content/types'
import './App.css'

const { Header, Content } = Layout
const { Title, Text } = Typography
const VOICE_SPEAKER_EVENT = 'storytime:voice-speaker'

const PAGE_BACKGROUND_ASSETS = {
  characters: '/generated/characters-forest-background.png',
  places: '/generated/places-dolomites-background.png',
  learningGoals: '/generated/skills-finja-nola-learning-background.png',
  artifacts: '/generated/characters-forest-background.png',
} as const

const HOME_HERO_BACKGROUND = '/generated/storytime-backgrounds/storytime-background-twilight-forest-close-4x3-hd.jpg'

const menuItems = [
  { key: '/', label: 'Home' },
  { key: '/characters', label: 'Characters' },
  { key: '/places', label: 'Places' },
  { key: '/map', label: 'Map' },
  { key: '/artifacts', label: 'Artifacts' },
  { key: '/learning-goals', label: 'Lernziele' },
  { key: '/design-system', label: 'Design System' },
]

type AppHeaderProps = {
  source: StoryContent['source'] | undefined
  mode: 'home' | 'subpage'
  selectedNavKey?: string
  pageTitle?: string
  backUrl?: string
  backIcon?: 'close' | 'back'
  storyParticipants?: Array<{ id: 'character' | 'yoko'; name: string; avatarUrl?: string; isSpeaking?: boolean }>
}

function AppHeader({
  source,
  mode,
  selectedNavKey,
  pageTitle,
  backUrl,
  backIcon = 'close',
  storyParticipants,
}: AppHeaderProps) {
  const navigate = useNavigate()
  const isStoryHeader = Array.isArray(storyParticipants) && storyParticipants.length > 0

  return (
    <Header className="app-header">
      <div className="header-inner">
        {mode === 'home' ? (
          <>
            <div className="brand-area">
              <Link to="/" aria-label="Zur Startseite">
                <img src={storytimeLogo} alt="Storytime Logo" className="brand-logo-image" />
              </Link>
              <Tag color="blue" className="source-tag">
                {source === 'runtime' ? 'Runtime API' : 'Fallback YAML'}
              </Tag>
            </div>

            <Menu
              mode="horizontal"
              selectedKeys={[selectedNavKey ?? '/']}
              items={menuItems}
              className="top-nav"
              onClick={({ key }) => navigate(key)}
            />
          </>
        ) : (
          <div className="brand-area">
            <Link
              to={backUrl ?? '/'}
              className="app-header-back-link"
              aria-label={backIcon === 'back' ? 'Zurueck' : 'Schliessen'}
              title={pageTitle}
            >
              {backIcon === 'back' ? <ArrowLeftOutlined /> : <CloseOutlined />}
              <span className="app-header-page-title">Es war einmal vor langer, langer Zeit ...</span>
            </Link>
          </div>
        )}

        {isStoryHeader ? (
          <div className="header-user app-header-story-participants">
            <div className="app-header-conversation-participants">
              {storyParticipants!.map((participant) => (
                <span key={participant.name} className="app-header-conversation-participant">
                  <span className="app-header-avatar-shell">
                    {participant.isSpeaking ? (
                      <>
                        <span className="app-header-avatar-ring app-header-avatar-ring-1" />
                        <span className="app-header-avatar-ring app-header-avatar-ring-2" />
                      </>
                    ) : null}
                    <Avatar
                      src={participant.avatarUrl}
                      size={34}
                      className="app-header-page-avatar"
                    />
                  </span>
                  <span className="app-header-page-title app-header-conversation-participant-name">
                    {participant.name}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="header-user">
            <Text className="header-user-name">Yoko</Text>
            <Avatar src={userProfileAvatar} size={40} />
          </div>
        )}
      </div>
    </Header>
  )
}

type ContentCarouselProps = {
  title: string
  content: StoryContent
  type: 'characters' | 'places' | 'learningGoals' | 'artifacts'
  ids?: string[]
}

const isDefined = <T,>(value: T | undefined | null): value is T => value != null

function resolveCarouselItems(
  content: StoryContent,
  type: ContentCarouselProps['type'],
  ids?: string[],
): {
  id: string
  name: string
  image?: string
  kind: GameObjectKind
  properties: GameObjectProperty[]
  relationships: GameObjectRelationship[]
}[] {
  if (type === 'characters') {
    const pool = ids
      ? ids.map((id) => content.characters.find((c) => c.id === id)).filter(isDefined)
      : content.characters
    return pool
      .filter((c) => Boolean(c.images.profileImage?.file || c.images.portrait?.file))
      .map((c) => ({
        id: c.id,
        name: c.name,
        image: c.images.profileImage?.file ?? c.images.portrait?.file,
        kind: 'character' as const,
        properties: [
          { key: 'species', label: 'Art', value: c.basis.species },
          ...(c.basis.roleArchetype
            ? [{ key: 'role', label: 'Rolle', value: c.basis.roleArchetype }]
            : []),
        ],
        relationships: (c.relationships?.characters ?? []).slice(0, 2).map((relation, index) => ({
          key: `${c.id}-rel-${index}`,
          label: relation.type,
        })),
      }))
  }

  if (type === 'places') {
    const pool = ids
      ? ids.map((id) => content.places.find((p) => p.id === id)).filter(isDefined)
      : content.places
    return pool.map((p) => ({
      id: p.id,
      name: p.name,
      kind: 'place' as const,
      properties: [{ key: 'description', label: 'Beschreibung', value: p.description }],
      relationships: [],
    }))
  }

  if (type === 'artifacts') {
    const pool = ids
      ? ids.map((id) => content.artifacts.find((artifact) => artifact.id === id)).filter(isDefined)
      : content.artifacts
    return pool.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      image: artifact.images.portrait.file,
      kind: 'artifact' as const,
      properties: [
        { key: 'artifactType', label: 'Typ', value: artifact.artifactType },
        { key: 'purpose', label: 'Zweck', value: artifact.function.primaryPurpose },
      ],
      relationships: [],
    }))
  }

  const pool = ids
    ? ids.map((id) => content.learningGoals.find((goal) => goal.id === id)).filter(isDefined)
    : content.learningGoals
  return pool.map((goal) => ({
    id: goal.id,
    name: goal.name,
    kind: 'learning-goal' as const,
    properties: [{ key: 'ageRange', label: 'Alter', value: goal.ageRange.join(' · ') || '-' }],
    relationships: [],
  }))
}

function useCharactersWithConversations(): Set<string> {
  const [characterIds, setCharacterIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const response = await fetch('/api/conversations/characters-with-conversations')
        if (!response.ok) return
        const payload = (await response.json()) as { characterIds?: string[] }
        if (!cancelled && Array.isArray(payload.characterIds)) {
          setCharacterIds(new Set(payload.characterIds))
        }
      } catch {
        // silent fallback to empty set
      }
    }

    void load()
    return () => { cancelled = true }
  }, [])

  return characterIds
}

function ContentCarousel({ title, content, type, ids }: ContentCarouselProps) {
  const items = useMemo(() => resolveCarouselItems(content, type, ids), [content, type, ids])
  const fallbackImage =
    type === 'artifacts' ? PAGE_BACKGROUND_ASSETS.learningGoals : PAGE_BACKGROUND_ASSETS[type]
  const charactersWithConversations = useCharactersWithConversations()
  const isLearningGoalsType = type === 'learningGoals'

  return (
    <section className="content-section">
      <Title level={2} className="section-title">
        {title}
      </Title>
      <div className="card-grid">
        {items.map((item) => {
          const cardContent = (
            <Card key={item.id} className="content-card" bordered={false}>
              <GameObjectCard
                kind={item.kind}
                name={item.name}
                imageSrc={item.image ?? fallbackImage}
                properties={item.properties}
                relationships={item.relationships}
                showImage
                showKicker={false}
                showProperties={isLearningGoalsType}
                showRelationships={false}
              />
            </Card>
          )

          if (type === 'characters') {
            const target = charactersWithConversations.has(item.id)
              ? `/characters/${item.id}/story`
              : `/characters/${item.id}`
            return (
              <Link key={item.id} to={target} className="content-card-link">
                {cardContent}
              </Link>
            )
          }

          return cardContent
        })}
      </div>
    </section>
  )
}

function resolveLayoutBackground(pathname: string) {
  const startPageBackground = {
    background: `linear-gradient(92deg, rgba(3,9,28,0.78) 8%, rgba(3,9,28,0.28) 62%), url('${HOME_HERO_BACKGROUND}') center / cover no-repeat`,
  }

  if (pathname === '/') return startPageBackground

  if (pathname.startsWith('/map')) return { background: '#03091c' }

  const isGameObjectPath =
    pathname.startsWith('/characters') ||
    pathname.startsWith('/places') ||
    pathname.startsWith('/artifacts') ||
    pathname.startsWith('/learning-goals')

  if (isGameObjectPath) return startPageBackground

  return {
    background: `linear-gradient(92deg, rgba(3,9,28,0.84) 8%, rgba(3,9,28,0.44) 64%), url('${PAGE_BACKGROUND_ASSETS.characters}') center / cover no-repeat`,
  }
}

function HomePage({ content }: { content: StoryContent }) {
  return (
    <div className="home-hero">
      <div className="hero-headline">
        <Text className="hero-overline">Storytime</Text>
        <Title level={1} className="hero-title">
          Erfinde Welten und erschaffe Charaktere fuer deine Geschichten
        </Title>
        <Text className="hero-description">
          Storytime ist dein kreativer Startpunkt fuer eigene Abenteuer mit einzigartigen Figuren,
          Orten und Lernzielen. Starte mit deinem eigenen Charakter.
        </Text>
        <Space size="middle">
          <Link to="/create-character" className="vcb-button" aria-label="Create Character Seite oeffnen">
            <span className="vcb-icon-area">
              <AudioOutlined className="vcb-mic-icon" />
              <span className="vcb-label">Mit Merlin Character erstellen</span>
            </span>
          </Link>
          <Button
            shape="circle"
            size="large"
            className="hero-fav-btn"
            ghost
            icon={<HeartOutlined />}
          />
        </Space>
      </div>

      <ContentCarousel title="Characters" content={content} type="characters" />
    </div>
  )
}

function DesignSystemPage({ content }: { content: StoryContent }) {
  const sampleCharacter = content.characters[0]
  const samplePlace = content.places[0]
  const sampleArtifact = content.artifacts[0]
  const sampleLearningGoal = content.learningGoals[0]

  return (
    <section className="content-section">
      <Title level={2} className="section-title">
        Design System
      </Title>
      <Text className="home-subtitle">
        Diese Seite zeigt verfuegbare Standard-Komponenten und eure Custom-Komponenten.
      </Text>

      <div className="ds-grid">
        <Card className="ds-block" bordered={false} title="Base (Ant Design)">
          <Space wrap>
            <Button type="primary">Primary Button</Button>
            <Button>Default Button</Button>
            <Tag color="blue">Tag</Tag>
            <Switch defaultChecked />
          </Space>
          <Divider />
          <Input placeholder="Input Beispiel" />
        </Card>

        <Card className="ds-block" bordered={false} title="Navigation">
          <Text>Header mit Brand, Menu und Avatar wird global wiederverwendet.</Text>
          <Divider />
          <Text>Menu-Items: Home, Characters, Places, Lernziele, Design System.</Text>
        </Card>

        <Card className="ds-block" bordered={false} title="Custom: GameObject Card (Design System)">
          <div className="content-card-preview">
            <Card className="content-card" bordered={false}>
              <GameObjectCard
                kind="character"
                name={sampleCharacter?.name ?? 'Character Preview'}
                imageSrc={
                  sampleCharacter?.images.profileImage?.file ??
                  sampleCharacter?.images.portrait?.file ??
                  '/homepage-background.png'
                }
                properties={[
                  { key: 'species', label: 'Art', value: sampleCharacter?.basis.species ?? 'Unbekannt' },
                  { key: 'role', label: 'Rolle', value: sampleCharacter?.basis.roleArchetype ?? 'Character' },
                ]}
                relationships={[
                  { key: 'friend', label: 'friend_of' },
                  { key: 'mentor', label: 'mentor_of' },
                ]}
              />
            </Card>
          </div>
          <Divider />
          <Text>
            Jede Anzeige ist pro Nutzung steuerbar, z. B. nur Name (ohne Bild, Kicker, Properties, Relationships).
          </Text>
          <Divider />
          <div className="card-grid">
            <Card className="content-card" bordered={false}>
              <GameObjectCard
                kind="place"
                name={samplePlace?.name ?? 'Ort'}
                imageSrc={PAGE_BACKGROUND_ASSETS.places}
                properties={[{ key: 'description', label: 'Beschreibung', value: samplePlace?.description ?? '-' }]}
              />
            </Card>
            <Card className="content-card" bordered={false}>
              <GameObjectCard
                kind="artifact"
                name={sampleArtifact?.name ?? 'Artefakt'}
                imageSrc={sampleArtifact?.images.portrait.file ?? PAGE_BACKGROUND_ASSETS.artifacts}
                properties={[
                  { key: 'type', label: 'Typ', value: sampleArtifact?.artifactType ?? '-' },
                  { key: 'purpose', label: 'Zweck', value: sampleArtifact?.function.primaryPurpose ?? '-' },
                ]}
              />
            </Card>
            <Card className="content-card" bordered={false}>
              <GameObjectCard
                kind="learning-goal"
                name={sampleLearningGoal?.name ?? 'Lernziel'}
                imageSrc={PAGE_BACKGROUND_ASSETS.learningGoals}
                properties={[
                  { key: 'subject', label: 'Fach', value: sampleLearningGoal?.subject ?? '-' },
                  { key: 'topic', label: 'Thema', value: sampleLearningGoal?.topic ?? '-' },
                ]}
              />
            </Card>
            <Card className="content-card" bordered={false}>
              <GameObjectCard
                kind="user"
                name="Yoko"
                imageSrc={userProfileAvatar}
                properties={[
                  { key: 'role', label: 'Rolle', value: 'User' },
                  { key: 'status', label: 'Status', value: 'Aktiv' },
                ]}
                relationships={[{ key: 'chat', label: 'chat_with_character' }]}
              />
            </Card>
            <Card className="content-card" bordered={false}>
              <GameObjectCard
                kind="character"
                name={sampleCharacter?.name ?? 'Nur Name'}
                showImage={false}
                showKicker={false}
                showProperties={false}
                showRelationships={false}
              />
            </Card>
          </div>
        </Card>

        <Card className="ds-block" bordered={false} title="Custom: Relationship Pill">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <RelationshipPill
              to="#"
              name={sampleCharacter?.name ?? 'Character'}
              imageSrc={
                sampleCharacter?.images.profileImage?.file ??
                sampleCharacter?.images.portrait?.file
              }
              relationLabel="Freund"
            />
            <RelationshipPill
              to="#"
              name={content.characters[1]?.name ?? 'Zweiter Character'}
              imageSrc={
                content.characters[1]?.images.profileImage?.file ??
                content.characters[1]?.images.portrait?.file
              }
            />
            <RelationshipPill
              to="#"
              name="Nur Name"
            />
          </div>
          <Divider />
          <Text>
            Kompakte Pill-Darstellung fuer Beziehungen auf der Character-Detail-Seite.
            Bild und relationLabel sind optional.
          </Text>
        </Card>

        <Card className="ds-block" bordered={false} title="Custom: Home Link Card">
          <Link to="/characters" className="home-link-card">
            <Title level={3}>Characters</Title>
            <Text>{content.characters.length} Eintraege</Text>
          </Link>
        </Card>
      </div>
    </section>
  )
}

function App() {
  const location = useLocation()
  const [content, setContent] = useState<StoryContent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [storySpeakerState, setStorySpeakerState] = useState<{
    characterId: string | null
    yokoSpeaking: boolean
    characterSpeaking: boolean
  }>({
    characterId: null,
    yokoSpeaking: false,
    characterSpeaking: false,
  })
  const pointerFrameRef = useRef<number | null>(null)
  const layoutBackground = useMemo(() => resolveLayoutBackground(location.pathname), [location.pathname])
  const isHomeParallaxEnabled = location.pathname === '/' && !reduceMotion

  const loadContent = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const loadedContent = await loadStoryContent()
      setContent(loadedContent)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    const loadContentSafely = async () => {
      setLoading(true)
      setError(null)
      try {
        const loadedContent = await loadStoryContent()
        if (mounted) setContent(loadedContent)
      } catch (err) {
        if (mounted) setError(String(err))
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void loadContentSafely()
    return () => {
      mounted = false
    }
  }, [loadContent])

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
    return () => {
      if (pointerFrameRef.current != null) {
        window.cancelAnimationFrame(pointerFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onSpeakerEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ characterId?: string; speaker?: string; isSpeaking?: boolean }>).detail
      const characterId = typeof detail?.characterId === 'string' ? detail.characterId : ''
      const speaker = detail?.speaker
      const isSpeaking = Boolean(detail?.isSpeaking)
      if (!characterId || (speaker !== 'yoko' && speaker !== 'character')) return

      setStorySpeakerState((prev) => {
        const next = {
          characterId,
          yokoSpeaking:
            prev.characterId === characterId ? prev.yokoSpeaking : false,
          characterSpeaking:
            prev.characterId === characterId ? prev.characterSpeaking : false,
        }
        if (speaker === 'yoko') next.yokoSpeaking = isSpeaking
        if (speaker === 'character') next.characterSpeaking = isSpeaking
        return next
      })
    }

    window.addEventListener(VOICE_SPEAKER_EVENT, onSpeakerEvent as EventListener)
    return () => {
      window.removeEventListener(VOICE_SPEAKER_EVENT, onSpeakerEvent as EventListener)
    }
  }, [])

  const updateParallaxVariables = useCallback(
    (element: HTMLElement, xOffset: number, yOffset: number, glareX: number, glareY: number) => {
      if (pointerFrameRef.current != null) {
        window.cancelAnimationFrame(pointerFrameRef.current)
      }

      pointerFrameRef.current = window.requestAnimationFrame(() => {
        element.style.setProperty('--bg-parallax-x', `${xOffset.toFixed(2)}px`)
        element.style.setProperty('--bg-parallax-y', `${yOffset.toFixed(2)}px`)
        element.style.setProperty('--bg-glare-x', `${glareX.toFixed(2)}%`)
        element.style.setProperty('--bg-glare-y', `${glareY.toFixed(2)}%`)
      })
    },
    [],
  )

  const handleLayoutMouseMove = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (!isHomeParallaxEnabled) return

      const element = event.currentTarget
      const bounds = element.getBoundingClientRect()
      const normalizedX = (event.clientX - bounds.left) / bounds.width - 0.5
      const normalizedY = (event.clientY - bounds.top) / bounds.height - 0.5

      updateParallaxVariables(
        element,
        normalizedX * -16,
        normalizedY * -10,
        50 + normalizedX * 24,
        44 + normalizedY * 18,
      )
    },
    [isHomeParallaxEnabled, updateParallaxVariables],
  )

  const resetLayoutParallax = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const element = event.currentTarget
    updateParallaxVariables(element, 0, 0, 50, 44)
  }, [updateParallaxVariables])

  const headerProps = useMemo((): Omit<AppHeaderProps, 'source'> => {
    const path = location.pathname
    if (path === '/') return { mode: 'home', selectedNavKey: '/' }

    const charMatch = path.match(/^\/characters\/([^/]+)/)
    if (charMatch) {
      const charId = charMatch[1]
      const character = content?.characters.find((c) => c.id === charId)
      const charName = character?.name
      const charAvatarUrl = character?.images.profileImage?.file ?? character?.images.portrait?.file
      if (path.match(/^\/characters\/[^/]+\/story$/)) {
        return {
          mode: 'subpage',
          pageTitle: charName ?? 'Story',
          backUrl: `/characters/${charId}`,
          backIcon: 'close',
          storyParticipants: [
            {
              id: 'character',
              name: charName ?? 'Character',
              avatarUrl: charAvatarUrl,
              isSpeaking:
                storySpeakerState.characterId === charId && storySpeakerState.characterSpeaking,
            },
            {
              id: 'yoko',
              name: 'Yoko',
              avatarUrl: userProfileAvatar,
              isSpeaking:
                storySpeakerState.characterId === charId && storySpeakerState.yokoSpeaking,
            },
          ],
        }
      }
      return {
        mode: 'subpage',
        pageTitle: charName ?? 'Character',
        backUrl: '/characters',
        backIcon: 'back',
      }
    }
    if (path.startsWith('/characters')) return { mode: 'home', selectedNavKey: '/characters' }
    if (path.startsWith('/places')) return { mode: 'home', selectedNavKey: '/places' }
    if (path.startsWith('/map')) return { mode: 'home', selectedNavKey: '/map' }
    if (path.startsWith('/artifacts')) return { mode: 'home', selectedNavKey: '/artifacts' }
    if (path.startsWith('/learning-goals') || path.startsWith('/skills')) return { mode: 'home', selectedNavKey: '/learning-goals' }
    if (path.startsWith('/design-system')) return { mode: 'subpage', pageTitle: 'Design System', backUrl: '/' }
    if (path.startsWith('/create-character')) {
      return { mode: 'subpage', pageTitle: 'Character erstellen', backUrl: '/', backIcon: 'back' }
    }
    return { mode: 'subpage', pageTitle: '', backUrl: '/' }
  }, [location.pathname, content?.characters, storySpeakerState])

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#3ca1fe',
          borderRadius: 18,
          fontFamily:
            "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          colorBgLayout: 'transparent',
        },
        components: {
          Layout: {
            bodyBg: 'transparent',
            headerBg: 'transparent',
          },
        },
      }}
    >
      <Layout
        className={`landing-layout ${
          location.pathname === '/'
            ? `landing-layout-home ${isHomeParallaxEnabled ? 'landing-layout-home-parallax' : ''}`
            : location.pathname.startsWith('/map')
              ? 'landing-layout-map'
              : location.pathname.match(/^\/characters\/[^/]+\/story$/)
                ? 'landing-layout-character-story'
                : location.pathname.startsWith('/characters/')
                  ? 'landing-layout-character-detail'
                  : 'landing-layout-inner'
        }`}
        style={layoutBackground}
        onMouseMove={handleLayoutMouseMove}
        onMouseLeave={resetLayoutParallax}
      >
        <AppHeader source={content?.source} {...headerProps} />

        <Content className="page-content">
          {loading && (
            <div className="loading-fullscreen">
              <div className="loading-orb">
                <div className="loading-orb-ring loading-orb-ring-1" />
                <div className="loading-orb-ring loading-orb-ring-2" />
                <div className="loading-orb-ring loading-orb-ring-3" />
                <div className="loading-orb-core" />
              </div>
              <Text className="loading-label">Lade Storytime-Content ...</Text>
            </div>
          )}

          {error && (
            <Alert
              type="error"
              showIcon
              className="state-box"
              message="Content konnte nicht geladen werden"
              description={error}
            />
          )}

          {content && (
            <>
              {content.warnings.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  className="state-box"
                  message="Runtime-Laden fehlgeschlagen, Fallback aktiv"
                  description={content.warnings.join(' | ')}
                />
              )}

              <Routes>
                <Route path="/" element={<HomePage content={content} />} />
                <Route
                  path="/characters"
                  element={<ContentCarousel title="Characters" content={content} type="characters" />}
                />
                <Route
                  path="/characters/:id"
                  element={<CharacterDetailPage content={content} />}
                />
                <Route
                  path="/characters/:id/story"
                  element={<CharacterStoryPage content={content} />}
                />
                <Route
                  path="/places"
                  element={<ContentCarousel title="Places" content={content} type="places" />}
                />
                <Route path="/map" element={<MapPage content={content} />} />
                <Route
                  path="/artifacts"
                  element={<ContentCarousel title="Artifacts" content={content} type="artifacts" />}
                />
                <Route
                  path="/learning-goals"
                  element={<LearningGoalsPage content={content} />}
                />
                <Route path="/skills" element={<Navigate to="/learning-goals" replace />} />
                <Route
                  path="/create-character"
                  element={<CreateCharacterPage content={content} onCharacterCreated={loadContent} />}
                />
                <Route
                  path="/design-system"
                  element={<DesignSystemPage content={content} />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </>
          )}
        </Content>
      </Layout>
    </ConfigProvider>
  )
}

export default App
