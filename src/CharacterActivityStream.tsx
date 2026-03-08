import { useState } from 'react'
import { Link } from 'react-router-dom'

export type CharacterActivityItem = {
  id: string
  timestamp: string | Date
  isPublic?: boolean
  rawActivityType?: string
  subject: string
  activityType: string
  object: string
  summary?: string
  conversationId?: string
  conversationUrl?: string
  conversationLabel?: string
  imageUrl?: string
  imageLabel?: string
  imagePrompt?: string
}

type Props = {
  items: CharacterActivityItem[]
  isLive?: boolean
  onOpenConversation?: (conversationId: string) => void
  onSelectImage?: (imageUrl: string, item: CharacterActivityItem) => void
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

export default function CharacterActivityStream({
  items,
  isLive = false,
  onOpenConversation,
  onSelectImage,
}: Props) {
  const [expandedReports, setExpandedReports] = useState<Record<string, boolean>>({})

  if (items.length === 0) return null

  return (
    <aside className="character-activity-stream" aria-label="Character activity stream">
      <p className="character-activity-stream-title">
        Activity
        {isLive ? <span className="character-activity-live-indicator"> Live</span> : null}
      </p>
      <ol className="character-activity-list">
        {items.map((item) => {
          const conversationId = item.conversationId
          const imageUrl = item.imageUrl
          const reportText = item.imagePrompt?.trim() ?? ''
          const reportLineCount = reportText ? reportText.split('\n').length : 0
          const isLongReport = reportText.length > 220 || reportLineCount > 3
          const isExpanded = expandedReports[item.id] === true
          return (
            <li key={item.id} className="character-activity-item">
              <div className="character-activity-marker" aria-hidden="true">
                <span className="character-activity-dot" />
              </div>
              <div className="character-activity-content">
                <time className="character-activity-timestamp">{formatTimestamp(item.timestamp)}</time>
                <p className="character-activity-text">
                  {item.isPublic === false ? (
                    <span className="character-activity-object">Intern: </span>
                  ) : null}
                  {item.summary ? (
                    <span>{item.summary}</span>
                  ) : (
                    <>
                      <span className="character-activity-subject">{item.subject}</span>
                      <span>{` - ${item.activityType} -> `}</span>
                      <span className="character-activity-object">{item.object}</span>
                    </>
                  )}
                  {item.conversationUrl ? (
                    <>
                      <span>{' ('}</span>
                      <Link className="character-activity-link" to={item.conversationUrl}>
                        {item.conversationLabel ?? 'Link zur Conversation'}
                      </Link>
                      <span>{')'}</span>
                    </>
                  ) : conversationId && item.conversationLabel && onOpenConversation ? (
                    <>
                      <span>{' ('}</span>
                      <button
                        type="button"
                        className="character-activity-link character-activity-link-button"
                        onClick={() => onOpenConversation(conversationId)}
                      >
                        {item.conversationLabel}
                      </button>
                      <span>{')'}</span>
                    </>
                  ) : item.conversationLabel ? (
                    <span>{` (${item.conversationLabel})`}</span>
                  ) : null}
                  {imageUrl ? (
                    <>
                      <span>{' ('}</span>
                      {onSelectImage ? (
                        <button
                          type="button"
                          className="character-activity-link character-activity-link-button"
                          onClick={() => onSelectImage(imageUrl, item)}
                        >
                          {item.imageLabel ?? 'Bild ansehen'}
                        </button>
                      ) : (
                        <a
                          className="character-activity-link"
                          href={imageUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {item.imageLabel ?? 'Bild ansehen'}
                        </a>
                      )}
                      <span>{')'}</span>
                    </>
                  ) : null}
                </p>
                {item.imagePrompt ? (
                  <>
                    <p className={`character-activity-prompt ${!isExpanded ? 'is-collapsed' : ''}`}>
                      <strong>Prompt:</strong> {item.imagePrompt}
                    </p>
                    {isLongReport ? (
                      <button
                        type="button"
                        className="character-activity-toggle"
                        onClick={() =>
                          setExpandedReports((current) => ({
                            ...current,
                            [item.id]: !isExpanded,
                          }))
                        }
                      >
                        {isExpanded ? 'Weniger anzeigen' : 'Mehr anzeigen'}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
