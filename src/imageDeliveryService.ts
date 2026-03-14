const warmedUrls = new Set<string>()

const isCharacterAsset = (url: string): boolean => url.includes('/content/characters/')

export const derivePreviewImageUrl = (url: string | undefined): string | undefined => {
  if (!url) return undefined
  const normalized = url.trim()
  if (!normalized) return undefined

  if (isCharacterAsset(normalized)) {
    if (
      normalized.endsWith('/hero-image.jpg') ||
      normalized.endsWith('/portrait.png') ||
      normalized.endsWith('/standard-figur.png')
    ) {
      return normalized.replace(/\/(hero-image\.jpg|portrait\.png|standard-figur\.png)$/i, '/profilbild.png')
    }
  }

  if (/\.(jpe?g)$/i.test(normalized) && !/\.thumb\.jpg$/i.test(normalized)) {
    return normalized.replace(/\.(jpe?g)$/i, '.thumb.jpg')
  }

  return normalized
}

const preloadImage = async (url: string): Promise<void> => {
  await new Promise<void>((resolve) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => resolve()
    image.src = url
  })
}

const scheduleIdle = (task: () => void): void => {
  if (typeof window === 'undefined') return
  const requestIdle = (window as Window & { requestIdleCallback?: (callback: () => void) => number })
    .requestIdleCallback
  if (typeof requestIdle === 'function') {
    requestIdle(task)
    return
  }
  window.setTimeout(task, 80)
}

export const warmImageCacheInBackground = (urls: Array<string | undefined>): void => {
  if (typeof window === 'undefined') return
  const uniqueUrls = Array.from(
    new Set(
      urls
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  )

  for (const url of uniqueUrls) {
    if (warmedUrls.has(url)) continue
    warmedUrls.add(url)
    scheduleIdle(() => {
      void preloadImage(url)
      const preview = derivePreviewImageUrl(url)
      if (preview && preview !== url) {
        void preloadImage(preview)
      }
    })
  }
}
