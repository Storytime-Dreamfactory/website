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
import { HeartOutlined } from '@ant-design/icons'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import storytimeLogo from './assets/storytime-logo.png'
import userProfileAvatar from './assets/user-profile-avatar.png'
import CharacterDetailPage from './CharacterDetailPage'
import CharacterCreationChatOverlay from './CharacterCreationChatOverlay'
import { loadStoryContent } from './content/loaders'
import type { StoryContent } from './content/types'
import './App.css'

const { Header, Content, Footer } = Layout
const { Title, Text } = Typography

const PAGE_BACKGROUND_ASSETS = {
  characters: '/generated/characters-forest-background.png',
  places: '/generated/places-dolomites-background.png',
  learningGoals: '/generated/skills-finja-nola-learning-background.png',
} as const

const HOME_HERO_BACKGROUND = '/generated/storytime-backgrounds/storytime-background-twilight-forest-close-4x3-hd.jpg'

const menuItems = [
  { key: '/', label: 'Home' },
  { key: '/characters', label: 'Characters' },
  { key: '/places', label: 'Places' },
  { key: '/learning-goals', label: 'Lernziele' },
  { key: '/design-system', label: 'Design System' },
]

function AppHeader({ source }: { source: StoryContent['source'] | undefined }) {
  const location = useLocation()
  const navigate = useNavigate()

  const selectedKey = useMemo(() => {
    if (location.pathname === '/') return '/'
    if (location.pathname.startsWith('/design-system')) return '/design-system'
    if (location.pathname.startsWith('/places')) return '/places'
    if (
      location.pathname.startsWith('/learning-goals') ||
      location.pathname.startsWith('/skills')
    ) {
      return '/learning-goals'
    }
    if (location.pathname.startsWith('/characters')) return '/characters'
    return '/'
  }, [location.pathname])

  return (
    <Header className="app-header">
      <div className="header-inner">
        <div className="brand-area">
          <Link to="/" aria-label="Zur Startseite">
            <img src={storytimeLogo} alt="Storytime Logo" className="brand-logo-image" />
          </Link>
          <Tag color="blue" className="source-tag">
            {source === 'runtime' ? 'Runtime YAML' : 'Fallback YAML'}
          </Tag>
        </div>

        <Menu
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={menuItems}
          className="top-nav"
          onClick={({ key }) => navigate(key)}
        />

        <div className="header-user">
          <Text className="header-user-name">Yoko</Text>
          <Avatar src={userProfileAvatar} size={40} />
        </div>
      </div>
    </Header>
  )
}

type ContentCarouselProps = {
  title: string
  content: StoryContent
  type: 'characters' | 'places' | 'learningGoals'
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
    return pool.map((c) => ({ id: c.id, name: c.name, image: c.images.portrait?.file }))
  }

  if (type === 'places') {
    const pool = ids
      ? ids.map((id) => content.places.find((p) => p.id === id)).filter(isDefined)
      : content.places
    return pool.map((p) => ({ id: p.id, name: p.name }))
  }

  const pool = ids
    ? ids.map((id) => content.learningGoals.find((goal) => goal.id === id)).filter(isDefined)
    : content.learningGoals
  return pool.map((goal) => ({ id: goal.id, name: goal.name }))
}

function ContentCarousel({ title, content, type, ids }: ContentCarouselProps) {
  const items = useMemo(() => resolveCarouselItems(content, type, ids), [content, type, ids])
  const fallbackImage = PAGE_BACKGROUND_ASSETS[type]

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
            return (
              <Link key={item.id} to={`/characters/${item.id}`} className="content-card-link">
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

  return {
    background: `linear-gradient(92deg, rgba(3,9,28,0.84) 8%, rgba(3,9,28,0.44) 64%), url('${PAGE_BACKGROUND_ASSETS.characters}') center / cover no-repeat`,
  }
}

function HomePage({
  content,
  onCharacterCreated,
}: {
  content: StoryContent
  onCharacterCreated: () => Promise<void> | void
}) {
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
          <CharacterCreationChatOverlay onCharacterCreated={onCharacterCreated} />
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

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#3ca1fe',
          borderRadius: 18,
          fontFamily:
            "'Nunito', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
      }}
    >
      <Layout
        className={`landing-layout ${
          location.pathname === '/'
            ? `landing-layout-home ${isHomeParallaxEnabled ? 'landing-layout-home-parallax' : ''}`
            : location.pathname.startsWith('/characters/')
              ? 'landing-layout-character-detail'
              : 'landing-layout-inner'
        }`}
        style={layoutBackground}
        onMouseMove={handleLayoutMouseMove}
        onMouseLeave={resetLayoutParallax}
      >
        <AppHeader source={content?.source} />

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
                <Route path="/" element={<HomePage content={content} onCharacterCreated={loadContent} />} />
                <Route
                  path="/characters"
                  element={<ContentCarousel title="Characters" content={content} type="characters" />}
                />
                <Route
                  path="/characters/:id"
                  element={<CharacterDetailPage content={content} />}
                />
                <Route
                  path="/places"
                  element={<ContentCarousel title="Places" content={content} type="places" />}
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
                  path="/design-system"
                  element={<DesignSystemPage content={content} />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </>
          )}
        </Content>

        <Footer className="app-footer">Storytime 2026 - YAML Content Foundation</Footer>
      </Layout>
    </ConfigProvider>
  )
}

export default App
