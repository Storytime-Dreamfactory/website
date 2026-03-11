import { useState, type ReactNode } from 'react'
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
  imageUrls?: string[]
  imageLabel?: string
  imagePrompt?: string
  isPending?: boolean
  summaryCharacters?: Array<{ id: string; name: string }>
}

type Props = {
  items: CharacterActivityItem[]
  isLive?: boolean
  onOpenConversation?: (conversationId: string) => void
  onSelectImage?: (imageUrl: string, item: CharacterActivityItem) => void
}

const SUMMARY_PREVIEW_LENGTH = 220

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

const isLocalImageUrl = (value: string): boolean => {
  const normalized = value.trim()
  return normalized.startsWith('/')
}

const getSummaryPreview = (summary: string): { text: string; isTruncated: boolean } => {
  const normalized = summary.trim()
  if (normalized.length <= SUMMARY_PREVIEW_LENGTH) {
    return { text: normalized, isTruncated: false }
  }

  const preview = normalized.slice(0, SUMMARY_PREVIEW_LENGTH)
  const lastWordBoundary = preview.search(/\s+\S*$/)
  const safePreview = lastWordBoundary > SUMMARY_PREVIEW_LENGTH * 0.6 ? preview.slice(0, lastWordBoundary) : preview
  return { text: safePreview.trimEnd(), isTruncated: true }
}

const isWordBoundary = (value: string | undefined): boolean => {
  if (!value) return true
  return !/[A-Za-z0-9ÄÖÜäöüß]/.test(value)
}

const renderSummaryWithCharacterLinks = (
  summary: string,
  characters: Array<{ id: string; name: string }>,
): Array<string | ReactNode> => {
  if (characters.length === 0) return [summary]

  const uniqueCharacters = Array.from(
    new Map(
      characters
        .map((character) => ({
          id: character.id.trim(),
          name: character.name.trim(),
        }))
        .filter((character) => character.id.length > 0 && character.name.length > 0)
        .map((character) => [character.id, character] as const),
    ).values(),
  ).sort((a, b) => b.name.length - a.name.length)

  const lowerSummary = summary.toLowerCase()
  const nodes: Array<string | ReactNode> = []
  let cursor = 0

  while (cursor < summary.length) {
    let matchedCharacter: { id: string; name: string } | null = null
    for (const character of uniqueCharacters) {
      const candidateName = character.name
      const candidateLower = candidateName.toLowerCase()
      if (!lowerSummary.startsWith(candidateLower, cursor)) continue
      const previousChar = cursor > 0 ? summary[cursor - 1] : undefined
      const nextChar = summary[cursor + candidateName.length]
      if (!isWordBoundary(previousChar) || !isWordBoundary(nextChar)) continue
      matchedCharacter = character
      break
    }

    if (!matchedCharacter) {
      const nextCharacterStart = uniqueCharacters
        .map((character) => {
          const index = lowerSummary.indexOf(character.name.toLowerCase(), cursor + 1)
          return index >= 0 ? index : Number.POSITIVE_INFINITY
        })
        .reduce((best, current) => Math.min(best, current), Number.POSITIVE_INFINITY)
      const nextCursor = Number.isFinite(nextCharacterStart) ? nextCharacterStart : summary.length
      nodes.push(summary.slice(cursor, nextCursor))
      cursor = nextCursor
      continue
    }

    nodes.push(
      <Link key={`${matchedCharacter.id}-${cursor}`} className="character-activity-link" to={`/characters/${matchedCharacter.id}`}>
        {summary.slice(cursor, cursor + matchedCharacter.name.length)}
      </Link>,
    )
    cursor += matchedCharacter.name.length
  }

  return nodes
}

const renderActivitySummary = (
  summary: string,
  characters: Array<{ id: string; name: string }>,
): Array<string | ReactNode> => {
  const speakerMatch = summary.match(/^([^:\n]{1,160})(:\s*.*)$/s)
  if (!speakerMatch) {
    return renderSummaryWithCharacterLinks(summary, characters)
  }

  const [, speaker, remainder] = speakerMatch
  return [
    <strong key="activity-speaker">{renderSummaryWithCharacterLinks(speaker, characters)}</strong>,
    ...renderSummaryWithCharacterLinks(remainder, characters),
  ]
}

export default function CharacterActivityStream({
  items,
  isLive = false,
  onOpenConversation,
  onSelectImage,
}: Props) {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({})
  const [expandedSummaries, setExpandedSummaries] = useState<Record<string, boolean>>({})
  const latestConversationItem = items.find(
    (item) => Boolean(item.conversationUrl) || (Boolean(item.conversationId) && Boolean(onOpenConversation)),
  )

  if (items.length === 0) return null

  return (
    <aside className="character-activity-stream" aria-label="Character activity stream">
      <div className="character-activity-stream-header">
        <p className="character-activity-stream-title">
          Activity
          {isLive ? <span className="character-activity-live-indicator"> Live</span> : null}
        </p>
        {latestConversationItem?.conversationUrl ? (
          <Link className="character-activity-link character-activity-header-action" to={latestConversationItem.conversationUrl}>
            {latestConversationItem.conversationLabel ?? 'Conversation ansehen'}
          </Link>
        ) : latestConversationItem?.conversationId && onOpenConversation ? (
          <button
            type="button"
            className="character-activity-link character-activity-link-button character-activity-header-action"
            onClick={() => onOpenConversation(latestConversationItem.conversationId!)}
          >
            {latestConversationItem.conversationLabel ?? 'Conversation ansehen'}
          </button>
        ) : null}
      </div>
      <ol className="character-activity-list">
        {items.map((item) => {
          const imageCandidates =
            item.imageUrls && item.imageUrls.length > 0 ? item.imageUrls : item.imageUrl ? [item.imageUrl] : []
          const imageUrls = imageCandidates.filter(isLocalImageUrl)
          const fullSummary = item.summary?.trim() || `${item.subject} | ${item.activityType} | ${item.object}`
          const isSummaryExpanded = expandedSummaries[item.id] === true
          const summaryPreview = getSummaryPreview(fullSummary)
          const visibleSummary = isSummaryExpanded || !summaryPreview.isTruncated ? fullSummary : summaryPreview.text
          return (
            <li key={item.id} className="character-activity-item">
              <div className="character-activity-marker" aria-hidden="true">
                <span className="character-activity-dot" />
              </div>
              <div className="character-activity-content">
                <time className="character-activity-timestamp">{formatTimestamp(item.timestamp)}</time>
                {item.isPending ? (
                  <p className="character-activity-pending" aria-live="polite">
                    <span className="character-activity-pending-spinner" aria-hidden="true" />
                    <span>Tool laeuft...</span>
                  </p>
                ) : null}
                <p className="character-activity-text">
                  {renderActivitySummary(
                    visibleSummary,
                    item.summaryCharacters ?? [],
                  )}
                  {!isSummaryExpanded && summaryPreview.isTruncated ? (
                    <>
                      <span>... </span>
                      <button
                        type="button"
                        className="character-activity-link character-activity-link-button character-activity-inline-expand"
                        onClick={() =>
                          setExpandedSummaries((current) => ({
                            ...current,
                            [item.id]: true,
                          }))
                        }
                        aria-expanded="false"
                      >
                        Weiter lesen
                      </button>
                    </>
                  ) : null}
                </p>
                {imageUrls.length > 0 ? (
                  <div className="character-activity-image-shell">
                    <div className="character-activity-image-grid">
                      {imageUrls.map((url, index) => {
                        const imageStateKey = `${item.id}::${url}`
                        const isImageBroken = brokenImages[imageStateKey] === true
                        if (isImageBroken) {
                          return (
                            <div
                              key={imageStateKey}
                              className="character-activity-image-fallback"
                              role="img"
                              aria-label="Bild nicht verfuegbar"
                              title="Bild nicht verfuegbar"
                            >
                              <span className="character-activity-image-fallback-label">
                                Bild nicht verfuegbar
                              </span>
                            </div>
                          )
                        }

                        const imageTitle =
                          index === 0
                            ? (item.imageLabel ?? 'Bild ansehen')
                            : `Bild ${index + 1} ansehen`
                        const imageAlt =
                          index === 0
                            ? (item.imageLabel ?? 'Generiertes Bild')
                            : `Generiertes Bild ${index + 1}`

                        return onSelectImage ? (
                          <button
                            key={imageStateKey}
                            type="button"
                            className="character-activity-image-button"
                            onClick={() => onSelectImage(url, item)}
                            aria-label={imageTitle}
                            title={imageTitle}
                          >
                            <img
                              src={url}
                              alt={imageAlt}
                              className="character-activity-image"
                              onError={() =>
                                setBrokenImages((current) => ({
                                  ...current,
                                  [imageStateKey]: true,
                                }))
                              }
                            />
                          </button>
                        ) : (
                          <a
                            key={imageStateKey}
                            className="character-activity-image-link"
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={imageTitle}
                            title={imageTitle}
                          >
                            <img
                              src={url}
                              alt={imageAlt}
                              className="character-activity-image"
                              onError={() =>
                                setBrokenImages((current) => ({
                                  ...current,
                                  [imageStateKey]: true,
                                }))
                              }
                            />
                          </a>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
