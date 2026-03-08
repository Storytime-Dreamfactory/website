import { Link } from 'react-router-dom'

export type CharacterActivityItem = {
  id: string
  timestamp: string | Date
  subject: string
  activityType: string
  object: string
  summary?: string
  conversationUrl?: string
  conversationLabel?: string
}

type Props = {
  items: CharacterActivityItem[]
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

export default function CharacterActivityStream({ items }: Props) {
  if (items.length === 0) return null

  return (
    <aside className="character-activity-stream" aria-label="Character activity stream">
      <p className="character-activity-stream-title">Activity</p>
      <ol className="character-activity-list">
        {items.map((item) => (
          <li key={item.id} className="character-activity-item">
            <div className="character-activity-marker" aria-hidden="true">
              <span className="character-activity-dot" />
            </div>
            <div className="character-activity-content">
              <time className="character-activity-timestamp">{formatTimestamp(item.timestamp)}</time>
              <p className="character-activity-text">
                {item.summary ? (
                  <span>{item.summary}</span>
                ) : (
                  <>
                    <span className="character-activity-subject">{item.subject}</span>
                    <span>{` - ${item.activityType} -> `}</span>
                    <span className="character-activity-object">{item.object}</span>
                  </>
                )}
                {item.conversationUrl && (
                  <>
                    <span>{' ('}</span>
                    <Link className="character-activity-link" to={item.conversationUrl}>
                      {item.conversationLabel ?? 'Link zur Conversation'}
                    </Link>
                    <span>{')'}</span>
                  </>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  )
}
