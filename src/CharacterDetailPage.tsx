import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Button, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, HeartOutlined } from '@ant-design/icons'
import type { StoryContent } from './content/types'
import VoiceChatButton from './VoiceChatButton'

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

export default function CharacterDetailPage({ content }: Props) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [reduceMotion, setReduceMotion] = useState(false)
  const pointerFrameRef = useRef<number | null>(null)
  const [apiRelationships, setApiRelationships] = useState<ApiRelationship[] | null>(null)

  const character = useMemo(
    () => content.characters.find((c) => c.id === id),
    [content.characters, id],
  )
  const heroUrl = character?.images.heroImage?.file
  const isHeroParallaxEnabled = Boolean(heroUrl) && !reduceMotion

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
    if (!heroUrl) return undefined
    return {
      '--character-hero-url': `url('${heroUrl}')`,
    } as CSSProperties
  }, [heroUrl])

  return (
    <div
      className={`character-detail ${
        heroUrl ? 'character-detail-has-hero' : ''
      } ${isHeroParallaxEnabled ? 'character-detail-parallax' : ''}`}
      style={detailStyle}
      onMouseMove={handleHeroMouseMove}
      onMouseLeave={resetHeroParallax}
    >
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

      </div>

    </div>
  )
}
