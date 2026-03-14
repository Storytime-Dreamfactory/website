import { Tag, Typography } from 'antd'
import ProgressiveImage from '../../ProgressiveImage'

const { Title, Text } = Typography

export type GameObjectKind = 'character' | 'place' | 'artifact' | 'learning-goal' | 'user'

export type GameObjectProperty = {
  key: string
  label: string
  value: string
}

export type GameObjectRelationship = {
  key: string
  label: string
}

export type GameObjectCardProps = {
  kind: GameObjectKind
  name: string
  imageSrc?: string
  imageAlt?: string
  kicker?: string
  properties?: GameObjectProperty[]
  relationships?: GameObjectRelationship[]
  showImage?: boolean
  showKicker?: boolean
  showName?: boolean
  showProperties?: boolean
  showRelationships?: boolean
}

const DEFAULT_KICKER_BY_KIND: Record<GameObjectKind, string> = {
  character: 'Character',
  place: 'Place',
  artifact: 'Artifact',
  'learning-goal': 'Learning Goal',
  user: 'User',
}

const formatPropertyText = (property: GameObjectProperty): string => `${property.label}: ${property.value}`

export function GameObjectPropertyList({ properties }: { properties: GameObjectProperty[] }) {
  if (properties.length === 0) return null
  return (
    <div className="game-object-property-list">
      {properties.slice(0, 2).map((property) => (
        <Text key={property.key} className="game-object-property-text">
          {formatPropertyText(property)}
        </Text>
      ))}
    </div>
  )
}

export function GameObjectRelationshipTags({ relationships }: { relationships: GameObjectRelationship[] }) {
  if (relationships.length === 0) return null
  return (
    <div className="game-object-relationship-tags">
      {relationships.slice(0, 2).map((relationship) => (
        <Tag key={relationship.key} className="game-object-relationship-tag">
          {relationship.label}
        </Tag>
      ))}
    </div>
  )
}

export function GameObjectCardOverlay({
  kind,
  name,
  kicker,
  properties = [],
  relationships = [],
  showKicker = true,
  showName = true,
  showProperties = true,
  showRelationships = true,
}: Pick<
  GameObjectCardProps,
  'kind' | 'name' | 'kicker' | 'properties' | 'relationships' | 'showKicker' | 'showName' | 'showProperties' | 'showRelationships'
>) {
  const visibleProperties = showProperties ? properties : []
  const visibleRelationships = showRelationships ? relationships : []
  const hasVisibleContent = showKicker || showName || visibleProperties.length > 0 || visibleRelationships.length > 0
  if (!hasVisibleContent) return null

  return (
    <div className="content-card-overlay">
      <div className="game-object-overlay-copy">
        {showKicker ? <Text className="game-object-kicker">{kicker ?? DEFAULT_KICKER_BY_KIND[kind]}</Text> : null}
        {showName ? (
          <Title level={4} className="content-card-title">
            {name}
          </Title>
        ) : null}
        <GameObjectPropertyList properties={visibleProperties} />
        <GameObjectRelationshipTags relationships={visibleRelationships} />
      </div>
    </div>
  )
}

export default function GameObjectCard({
  kind,
  name,
  imageSrc,
  imageAlt,
  kicker,
  properties = [],
  relationships = [],
  showImage = true,
  showKicker = true,
  showName = true,
  showProperties = true,
  showRelationships = true,
}: GameObjectCardProps) {
  return (
    <div className={`content-card-media${showImage && imageSrc ? '' : ' game-object-card-media-no-image'}`}>
      {showImage && imageSrc ? (
        <ProgressiveImage
          src={imageSrc}
          alt={imageAlt ?? name}
          className="content-card-image"
          loading="lazy"
          fetchPriority="low"
        />
      ) : null}
      <GameObjectCardOverlay
        kind={kind}
        name={name}
        kicker={kicker}
        properties={properties}
        relationships={relationships}
        showKicker={showKicker}
        showName={showName}
        showProperties={showProperties}
        showRelationships={showRelationships}
      />
    </div>
  )
}
