import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { Button, Tag, Typography } from 'antd'
import { BookOutlined } from '@ant-design/icons'
import type { StoryContent } from './content/types'
import VoiceChatButton from './VoiceChatButton'
import useCharacterData from './useCharacterData'

const { Title, Text } = Typography

type Props = {
  content: StoryContent
}

export default function CharacterDetailPage({ content }: Props) {

  const {
    id,
    navigate,
    character,
    heroUrl,
    relatedCharacters,
    activeHeroUrl,
    incomingHeroUrl,
    isMemoryOverlayActive,
    isHeroParallaxEnabled,
    detailStyle,
    handleHeroMouseMove,
    resetHeroParallax,
  } = useCharacterData({ content, loadActivities: false })

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
      </div>
    </div>
  )
}
