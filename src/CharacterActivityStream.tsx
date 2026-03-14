import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { CharacterActivityItem } from './activityPanelTypes'
import CharacterActivityRow from './CharacterActivityRow'
import useActiveScrollImage from './useActiveScrollImage'

type Props = {
  items: CharacterActivityItem[]
  isLive?: boolean
  onOpenConversation?: (conversationId: string) => void
  scrollContainerRef?: RefObject<HTMLElement | null>
  onScrollImageChange?: (imageUrl: string, item: CharacterActivityItem) => void
  hasMoreItems?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void | Promise<void>
}

const normalizeSummaryForDeduplication = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim()
}

export default function CharacterActivityStream({
  items,
  isLive = false,
  onOpenConversation,
  scrollContainerRef,
  onScrollImageChange,
  hasMoreItems = false,
  isLoadingMore = false,
  onLoadMore,
}: Props) {
  const rootRef = useRef<HTMLElement>(null)
  const { listRef } = useActiveScrollImage({
    items,
    scrollContainerRef,
    onScrollImageChange,
  })
  const getScrollContainer = useCallback(
    () => scrollContainerRef?.current ?? rootRef.current,
    [scrollContainerRef],
  )

  const evaluateLoadMore = useCallback(() => {
    if (!onLoadMore || !hasMoreItems || isLoadingMore) return
    const scrollContainer = getScrollContainer()
    if (!scrollContainer) return

    const remaining = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight
    if (remaining <= 240) {
      void onLoadMore()
    }
  }, [getScrollContainer, hasMoreItems, isLoadingMore, onLoadMore])

  useEffect(() => {
    const scrollContainer = getScrollContainer()
    if (!scrollContainer || !onLoadMore || !hasMoreItems) return

    const handleScroll = () => {
      evaluateLoadMore()
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [getScrollContainer, onLoadMore, hasMoreItems, evaluateLoadMore])

  useEffect(() => {
    if (!onLoadMore || !hasMoreItems || isLoadingMore) return
    const scrollContainer = getScrollContainer()
    if (!scrollContainer) return

    const hasScrollableOverflow = scrollContainer.scrollHeight > scrollContainer.clientHeight + 8
    if (!hasScrollableOverflow) {
      void onLoadMore()
    }
  }, [getScrollContainer, hasMoreItems, isLoadingMore, items.length, onLoadMore])

  if (items.length === 0) return null

  const seenSummaryKeys = new Set<string>()
  const deduplicatedItems = items.map((item) => {
    const rawSummary = item.summary?.trim() ?? ''
    if (!rawSummary) {
      return { item, hideSummary: false }
    }

    const summaryKey = normalizeSummaryForDeduplication(rawSummary)
    if (!summaryKey) {
      return { item, hideSummary: false }
    }

    if (seenSummaryKeys.has(summaryKey)) {
      return { item, hideSummary: true }
    }

    seenSummaryKeys.add(summaryKey)
    return { item, hideSummary: false }
  })

  return (
    <aside ref={rootRef} className="character-activity-stream" aria-label="Character activity stream">
      <div className="character-activity-stream-header">
        <p className="character-activity-stream-title">
          Activity
          {isLive ? <span className="character-activity-live-indicator"> Live</span> : null}
        </p>
      </div>
      <ol ref={listRef} className="character-activity-list">
        {deduplicatedItems.map(({ item, hideSummary }) => (
          <CharacterActivityRow
            key={item.id}
            item={item}
            hideSummary={hideSummary}
            onOpenConversation={onOpenConversation}
          />
        ))}
      </ol>
      {isLoadingMore ? <p className="character-activity-pending">Lade weitere Events...</p> : null}
    </aside>
  )
}
