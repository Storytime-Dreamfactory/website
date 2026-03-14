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
  Spin,
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
): { id: string; name: string; image?: string }[] {
  if (type === 'characters') {
    const pool = ids
      ? ids.map((id) => content.characters.find((c) => c.id === id)).filter(isDefined)
      : content.characters
    return pool
      .filter((c) => Boolean(c.images.portrait?.file))
      .map((c) => ({ id: c.id, name: c.name, image: c.images.portrait?.file }))
  }

  if (type === 'places') {
    const pool = ids
      ? ids.map((id) => content.places.find((p) => p.id === id)).filter(isDefined)
      : content.places
    return pool.map((p) => ({ id: p.id, name: p.name }))
  }

  if (type === 'artifacts') {
    const pool = ids
      ? ids.map((id) => content.artifacts.find((artifact) => artifact.id === id)).filter(isDefined)
      : content.artifacts
    return pool.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      image: artifact.images.portrait.file,
    }))
  }

  const pool = ids
    ? ids.map((id) => content.learningGoals.find((goal) => goal.id === id)).filter(isDefined)
    : content.learningGoals
  return pool.map((goal) => ({ id: goal.id, name: goal.name }))
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

  return (
    <section className="content-section">
      <Title level={2} className="section-title">
        {title}
      </Title>
      <div className="card-grid">
        {items.map((item) => {
          const cardContent = (
            <Card key={item.id} className="content-card" bordered={false}>
              <div className="content-card-media">
                <img src={item.image ?? fallbackImage} alt={item.name} className="content-card-image" />
                <div className="content-card-overlay">
                  <Title level={4} className="content-card-title">
                    {item.name}
                  </Title>
                </div>
              </div>
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
  if (pathname === '/') {
    return {
      background: `linear-gradient(92deg, rgba(3,9,28,0.78) 8%, rgba(3,9,28,0.28) 62%), url('${HOME_HERO_BACKGROUND}') center / cover no-repeat`,
    }
  }

  if (pathname.startsWith('/characters/')) {
    return undefined
  }

  if (pathname.startsWith('/places')) {
    return {
      background: `linear-gradient(92deg, rgba(6,12,34,0.82) 10%, rgba(6,12,34,0.42) 64%), url('${PAGE_BACKGROUND_ASSETS.places}') center / cover no-repeat`,
    }
  }

  if (pathname.startsWith('/learning-goals')) {
    return {
      background: `linear-gradient(92deg, rgba(8,11,28,0.86) 10%, rgba(8,11,28,0.46) 66%), url('${PAGE_BACKGROUND_ASSETS.learningGoals}') center / cover no-repeat`,
    }
  }

  if (pathname.startsWith('/artifacts')) {
    return {
      background: `linear-gradient(92deg, rgba(8,11,28,0.86) 10%, rgba(8,11,28,0.46) 66%), url('${PAGE_BACKGROUND_ASSETS.artifacts}') center / cover no-repeat`,
    }
  }

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

        <Card className="ds-block" bordered={false} title="Custom: Content Carousel Card">
          <div className="content-card-preview">
            <Card className="content-card" bordered={false}>
              <div className="content-card-media">
                <img
                  src={sampleCharacter?.images.portrait?.file ?? '/homepage-background.png'}
                  alt={sampleCharacter?.name ?? 'Preview'}
                  className="content-card-image"
                />
                <div className="content-card-overlay">
                  <Title level={4} className="content-card-title">
                    {sampleCharacter?.name ?? 'Carousel Card'}
                  </Title>
                </div>
              </div>
            </Card>
          </div>
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
            <div className="state-box">
              <Space>
                <Spin size="small" />
                <Text>Lade Storytime-Content...</Text>
              </Space>
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
                <Route
                  path="/artifacts"
                  element={<ContentCarousel title="Artifacts" content={content} type="artifacts" />}
                />
                <Route
                  path="/learning-goals"
                  element={
                    <ContentCarousel
                      title="Lernziele"
                      content={content}
                      type="learningGoals"
                    />
                  }
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
