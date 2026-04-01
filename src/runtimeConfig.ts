declare const __STORYTIME_USE_REMOTE_APIS__: boolean
declare const __STORYTIME_REMOTE_API_ORIGIN__: string
declare const __STORYTIME_REMOTE_CONTENT_ORIGIN__: string

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

const buildCacheNamespace = (): string => {
  if (!__STORYTIME_USE_REMOTE_APIS__) return 'local'
  const apiOrigin = trimTrailingSlash(__STORYTIME_REMOTE_API_ORIGIN__ || 'remote-api')
  const contentOrigin = trimTrailingSlash(__STORYTIME_REMOTE_CONTENT_ORIGIN__ || 'remote-content')
  return `online:${apiOrigin}|${contentOrigin}`
}

export const runtimeConfig = {
  useRemoteApis: __STORYTIME_USE_REMOTE_APIS__,
  remoteApiOrigin: trimTrailingSlash(__STORYTIME_REMOTE_API_ORIGIN__ || ''),
  remoteContentOrigin: trimTrailingSlash(__STORYTIME_REMOTE_CONTENT_ORIGIN__ || ''),
  cacheNamespace: buildCacheNamespace(),
} as const
