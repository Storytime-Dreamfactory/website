import { useEffect, useMemo, useState } from 'react'
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
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import storytimeIcon from './assets/storytime-icon.png'
import storytimeLogo from './assets/storytime-logo.png'
import { loadStoryContent } from './content/loaders'
import type { StoryContent } from './content/types'
import './App.css'

const { Header, Content, Footer } = Layout
const { Title, Text } = Typography

type CardItem = { id: string; name: string }

const imageFor = (): string => '/homepage-background.png'

const menuItems = [
  { key: '/', label: 'Home' },
  { key: '/characters', label: 'Characters' },
  { key: '/places', label: 'Places' },
  { key: '/skills', label: 'Skills' },
  { key: '/design-system', label: 'Design System' },
]

function AppHeader({ source }: { source: StoryContent['source'] | undefined }) {
  const location = useLocation()
  const navigate = useNavigate()

  const selectedKey = useMemo(() => {
    if (location.pathname === '/') return '/'
    if (location.pathname.startsWith('/design-system')) return '/design-system'
    if (location.pathname.startsWith('/places')) return '/places'
    if (location.pathname.startsWith('/skills')) return '/skills'
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

        <Avatar src={storytimeIcon} size={40} />
      </div>
    </Header>
  )
}

function PosterSection({
  title,
  items,
}: {
  title: string
  items: CardItem[]
}) {
  return (
    <section className="content-section">
      <Title level={2} className="section-title">
        {title}
      </Title>
      <div className="card-grid">
        {items.map((item) => (
          <Card key={item.id} className="content-card" bordered={false}>
            <div className="content-card-media">
              <img src={imageFor()} alt={item.name} className="content-card-image" />
              <div className="content-card-overlay">
                <Title level={4} className="content-card-title">
                  {item.name}
                </Title>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}

function HomePage({ content }: { content: StoryContent }) {
  return (
    <section className="home-section">
      <Title level={1} className="home-title">
        Storytime Home
      </Title>
      <Text className="home-subtitle">
        Waehle einen Bereich aus, um alle Characters, Places oder Skills als Karten zu sehen.
      </Text>

      <div className="home-link-grid">
        <Link to="/characters" className="home-link-card">
          <Title level={3}>Characters</Title>
          <Text>{content.characters.length} Eintraege</Text>
        </Link>
        <Link to="/places" className="home-link-card">
          <Title level={3}>Places</Title>
          <Text>{content.places.length} Eintraege</Text>
        </Link>
        <Link to="/skills" className="home-link-card">
          <Title level={3}>Skills</Title>
          <Text>{content.skills.length} Eintraege</Text>
        </Link>
        <Link to="/design-system" className="home-link-card">
          <Title level={3}>Design System</Title>
          <Text>AntD + Custom Components</Text>
        </Link>
      </div>
    </section>
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
          <Text>Menu-Items: Home, Characters, Places, Skills, Design System.</Text>
        </Card>

        <Card className="ds-block" bordered={false} title="Custom: Poster Card">
          <div className="content-card-preview">
            <Card className="content-card" bordered={false}>
              <div className="content-card-media">
                <img
                  src={imageFor()}
                  alt={sampleCharacter?.name ?? 'Preview'}
                  className="content-card-image"
                />
                <div className="content-card-overlay">
                  <Title level={4} className="content-card-title">
                    {sampleCharacter?.name ?? 'Poster Card'}
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

  useEffect(() => {
    let mounted = true

    const loadContent = async () => {
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

    void loadContent()
    return () => {
      mounted = false
    }
  }, [])

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
      <Layout className={`landing-layout ${location.pathname === '/' ? 'landing-layout-home' : 'landing-layout-inner'}`}>
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
                <Route path="/" element={<HomePage content={content} />} />
                <Route
                  path="/characters"
                  element={
                    <PosterSection
                      title="Characters"
                      items={content.characters}
                    />
                  }
                />
                <Route
                  path="/places"
                  element={<PosterSection title="Places" items={content.places} />}
                />
                <Route
                  path="/skills"
                  element={<PosterSection title="Skills" items={content.skills} />}
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

        <Footer className="app-footer">Storytime 2026 - YAML Content Foundation</Footer>
      </Layout>
    </ConfigProvider>
  )
}

export default App
