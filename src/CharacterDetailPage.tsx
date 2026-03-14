import { useMemo, useState, type CSSProperties } from 'react'
import { Button, Tag, Typography } from 'antd'
import { BookOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import type { Character, StoryContent } from './content/types'
import VoiceChatButton from './VoiceChatButton'
import useCharacterData from './useCharacterData'
import RelationshipPill from './design-system/gameObjects/RelationshipPill'

const { Title, Text } = Typography

type Props = {
  content: StoryContent
}

function collectCharacterImageUrls(character: Character): string[] {
  const candidates = [
    character.images.heroImage?.file,
    character.images.portrait?.file,
    character.images.profileImage?.file,
    character.images.standardFigure?.file,
    ...character.images.additionalImages.map((image) => image.file),
  ]

  const deduped = new Set<string>()
  const imageUrls: string[] = []
  for (const candidate of candidates) {
    if (!candidate || deduped.has(candidate)) continue
    deduped.add(candidate)
    imageUrls.push(candidate)
  }

  return imageUrls
}

export default function CharacterDetailPage({ content }: Props) {

  const {
    id,
    navigate,
    character,
    relatedCharacters,
    activeHeroUrl,
    incomingHeroUrl,
    isMemoryOverlayActive,
    isHeroParallaxEnabled,
    detailStyle,
    transitionToHeroUrl,
    handleHeroMouseMove,
    resetHeroParallax,
    setHeroViewMode,
  } = useCharacterData({ content, loadActivities: false })
  const imageUrls = useMemo(() => (character ? collectCharacterImageUrls(character) : []), [character])
  const [activeImageIndex, setActiveImageIndex] = useState(0)

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

  const cycleImage = (step: number) => {
    if (imageUrls.length === 0) return
    const nextIndex = (activeImageIndex + step + imageUrls.length) % imageUrls.length
    const nextImageUrl = imageUrls[nextIndex]
    if (!nextImageUrl) return
    setActiveImageIndex(nextIndex)
    setHeroViewMode('character-hero')
    transitionToHeroUrl(nextImageUrl)
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

      <div className="character-detail-content">
        <div className="character-detail-info">
          <div className="character-detail-image-nav" aria-label="Character-Bilder wechseln">
            <Button
              type="text"
              className="character-detail-image-nav-btn"
              onClick={() => cycleImage(-1)}
              aria-label="Vorheriges Bild"
              icon={<LeftOutlined />}
            />
            <Button
              type="text"
              className="character-detail-image-nav-btn"
              onClick={() => cycleImage(1)}
              aria-label="Naechstes Bild"
              icon={<RightOutlined />}
            />
          </div>
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
            <button
              className="vcb-button"
              type="button"
              onClick={() => navigate(`/characters/${id}/story`)}
            >
              <span className="vcb-icon-area">
                <BookOutlined className="vcb-mic-icon" />
                <span className="vcb-label">Geschichte erleben</span>
              </span>
            </button>
            <VoiceChatButton character={character} conversationId={null} />
          </div>

          {relatedCharacters.length > 0 && (
            <div className="character-detail-friends">
              <Text className="character-detail-friends-label">Beziehungen</Text>
              <div className="character-detail-friends-list">
                {relatedCharacters.map(({ char, relationLabel }) => (
                  <RelationshipPill
                    key={`${char.id}-${relationLabel}`}
                    to={`/characters/${char.id}`}
                    name={char.name}
                    imageSrc={char.images.profileImage?.file}
                    relationLabel={relationLabel}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
