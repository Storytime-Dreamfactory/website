import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { CharacterActivityItem } from './activityPanelTypes'

type UseActiveScrollImageOptions = {
  items: CharacterActivityItem[]
  scrollContainerRef?: RefObject<HTMLElement | null>
  onScrollImageChange?: (imageUrl: string, item: CharacterActivityItem) => void
}

const isLocalImageUrl = (value: string): boolean => {
  const normalized = value.trim()
  return normalized.startsWith('/')
}

export default function useActiveScrollImage({
  items,
  scrollContainerRef,
  onScrollImageChange,
}: UseActiveScrollImageOptions) {
  const listRef = useRef<HTMLOListElement>(null)
  const lastScrollImageIdRef = useRef<string | null>(null)
  const scrollRafRef = useRef<number | null>(null)
  const imageItemsMapRef = useRef(new Map<string, { imageUrl: string; item: CharacterActivityItem }>())

  useEffect(() => {
    const map = new Map<string, { imageUrl: string; item: CharacterActivityItem }>()
    for (const item of items) {
      const candidates =
        item.imageUrls && item.imageUrls.length > 0 ? item.imageUrls : item.imageUrl ? [item.imageUrl] : []
      const localUrls = candidates.filter(isLocalImageUrl)
      if (localUrls.length > 0) {
        map.set(item.id, { imageUrl: localUrls[0], item })
      }
    }
    imageItemsMapRef.current = map
  }, [items])

  const evaluateScrollPosition = useCallback(() => {
    const container = scrollContainerRef?.current
    if (!container || !listRef.current || !onScrollImageChange) return

    const containerRect = container.getBoundingClientRect()
    const midlineY = containerRect.top + containerRect.height * 0.5

    const imageElements = listRef.current.querySelectorAll<HTMLElement>('[data-scroll-image-id]')

    let activeId: string | null = null
    for (const el of imageElements) {
      const elRect = el.getBoundingClientRect()
      if (elRect.top <= midlineY) {
        activeId = el.dataset.scrollImageId ?? null
      } else {
        break
      }
    }

    if (!activeId && imageElements.length > 0) {
      activeId = imageElements[0].dataset.scrollImageId ?? null
    }

    if (activeId && activeId !== lastScrollImageIdRef.current) {
      lastScrollImageIdRef.current = activeId
      const entry = imageItemsMapRef.current.get(activeId)
      if (entry) {
        onScrollImageChange(entry.imageUrl, entry.item)
      }
    }
  }, [scrollContainerRef, onScrollImageChange])

  const handleScroll = useCallback(() => {
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current)
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      evaluateScrollPosition()
    })
  }, [evaluateScrollPosition])

  useEffect(() => {
    const container = scrollContainerRef?.current
    if (!container || !onScrollImageChange) return

    container.addEventListener('scroll', handleScroll, { passive: true })
    evaluateScrollPosition()

    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [scrollContainerRef, onScrollImageChange, handleScroll, evaluateScrollPosition])

  useEffect(() => {
    evaluateScrollPosition()
  }, [items, evaluateScrollPosition])

  return { listRef }
}
