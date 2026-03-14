import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CharacterActivityItem } from './activityPanelTypes'
import ProgressiveImage from './ProgressiveImage'

type Props = {
  item: CharacterActivityItem
  hideSummary?: boolean
  onOpenConversation?: (conversationId: string) => void
}
const CONVERSATION_BOUNDARY_ACTIVITY_TYPES = new Set(['character.chat.completed', 'conversation.ended'])

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

export default function CharacterActivityRow({ item, hideSummary = false, onOpenConversation }: Props) {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({})
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false)
  const isConversationBoundary = CONVERSATION_BOUNDARY_ACTIVITY_TYPES.has(item.rawActivityType ?? '')
  const canOpenConversation = Boolean(onOpenConversation && item.conversationId)

  const imageCandidates =
    item.imageUrls && item.imageUrls.length > 0 ? item.imageUrls : item.imageUrl ? [item.imageUrl] : []
  const imageUrls = imageCandidates.filter(isLocalImageUrl)
  const fullSummary = hideSummary
    ? ''
    : item.summary?.trim() || `${item.subject} | ${item.activityType} | ${item.object}`
  const summaryPreview = getSummaryPreview(fullSummary)
  const visibleSummary = isSummaryExpanded || !summaryPreview.isTruncated ? fullSummary : summaryPreview.text

  if (isConversationBoundary) {
    return (
      <li className="character-activity-item character-activity-item-conversation-divider">
        <div className="character-activity-content character-activity-conversation-divider-content">
          <span className="character-activity-conversation-divider-line" aria-hidden="true" />
          {canOpenConversation ? (
            <button
              type="button"
              className="character-activity-conversation-divider-button"
              onClick={() => onOpenConversation!(item.conversationId!)}
            >
              See conversation
            </button>
          ) : (
            <span className="character-activity-conversation-divider-label">Conversation ended</span>
          )}
          <span className="character-activity-conversation-divider-line" aria-hidden="true" />
        </div>
      </li>
    )
  }

  return (
    <li className="character-activity-item" {...(imageUrls.length > 0 ? { 'data-scroll-image-id': item.id } : undefined)}>
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
        {visibleSummary ? (
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
                  onClick={() => setIsSummaryExpanded(true)}
                  aria-expanded="false"
                >
                  Weiter lesen
                </button>
              </>
            ) : null}
          </p>
        ) : null}
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

                const imageAlt =
                  index === 0
                    ? (item.imageLabel ?? 'Generiertes Bild')
                    : `Generiertes Bild ${index + 1}`

                return (
                  <div key={imageStateKey} className="character-activity-image-frame">
                    <ProgressiveImage
                      src={url}
                      alt={imageAlt}
                      className="character-activity-image"
                      loading="lazy"
                      fetchPriority="low"
                      onError={() =>
                        setBrokenImages((current) => ({
                          ...current,
                          [imageStateKey]: true,
                        }))
                      }
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    </li>
  )
}
