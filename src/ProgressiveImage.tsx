import { useEffect, useMemo, useState } from 'react'
import { derivePreviewImageUrl } from './imageDeliveryService'

type Props = {
  src: string
  alt: string
  className?: string
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'low' | 'auto'
  onError?: () => void
}

export default function ProgressiveImage({
  src,
  alt,
  className,
  loading = 'lazy',
  fetchPriority = 'auto',
  onError,
}: Props) {
  const previewSrc = useMemo(() => derivePreviewImageUrl(src), [src])
  const [activeSrc, setActiveSrc] = useState(previewSrc ?? src)

  useEffect(() => {
    setActiveSrc(previewSrc ?? src)
    if (!src || src === previewSrc) return

    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (!cancelled) {
        setActiveSrc(src)
      }
    }
    image.onerror = () => {
      if (!cancelled) {
        setActiveSrc(src)
      }
    }
    image.src = src

    return () => {
      cancelled = true
    }
  }, [src, previewSrc])

  return (
    <img
      src={activeSrc}
      alt={alt}
      className={className}
      loading={loading}
      decoding="async"
      fetchPriority={fetchPriority}
      onError={onError}
    />
  )
}
