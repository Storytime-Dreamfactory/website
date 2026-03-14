import { Link } from 'react-router-dom'
import ProgressiveImage from '../../ProgressiveImage'

export type RelationshipPillProps = {
  to: string
  name: string
  imageSrc?: string
  relationLabel?: string
}

export default function RelationshipPill({ to, name, imageSrc, relationLabel }: RelationshipPillProps) {
  return (
    <Link to={to} className="relationship-pill">
      {imageSrc && (
        <ProgressiveImage
          src={imageSrc}
          alt={name}
          className="relationship-pill-avatar"
          loading="lazy"
          fetchPriority="low"
        />
      )}
      <div className="relationship-pill-info">
        <span className="relationship-pill-name">{name}</span>
        {relationLabel && (
          <span className="relationship-pill-type">{relationLabel}</span>
        )}
      </div>
    </Link>
  )
}
