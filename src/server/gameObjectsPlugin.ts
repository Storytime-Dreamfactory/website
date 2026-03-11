import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import * as gameObjectService from './gameObjectService.ts'
import { listRelationshipsForObject } from './relationshipStore.ts'
import type { Character, GameObjectType } from '../content/types.ts'

type MiddlewareStack = {
  use: (
    route: string,
    handler: (
      request: IncomingMessage,
      response: ServerResponse,
      next: (error?: unknown) => void,
    ) => void | Promise<void>,
  ) => void
}

const GAME_OBJECT_TYPES: GameObjectType[] = ['character', 'place', 'learning-goals', 'artifact']

const json = (response: ServerResponse, statusCode: number, data: unknown): void => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(data))
}

const toGameObjectType = (value: string | null): GameObjectType | null => {
  const normalized = value?.trim() ?? ''
  if (!normalized) return null
  return GAME_OBJECT_TYPES.includes(normalized as GameObjectType)
    ? (normalized as GameObjectType)
    : null
}

const decodePathSegment = (value: string): string => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

type GameObjectImage = {
  slot: 'standardFigure' | 'heroImage' | 'portrait' | 'profileImage' | 'additional'
  url: string
  description?: string
  type?: string
}

const listGameObjectImages = (gameObject: Awaited<ReturnType<typeof gameObjectService.get>>): GameObjectImage[] => {
  if (!gameObject || gameObject.type !== 'character') return []

  const character = gameObject as Character
  const images: GameObjectImage[] = []
  const addImage = (
    slot: GameObjectImage['slot'],
    image: { file?: string; description?: string },
    type?: string,
  ) => {
    const url = image.file?.trim()
    if (!url) return
    images.push({
      slot,
      url,
      description: image.description?.trim() || undefined,
      type,
    })
  }

  addImage('standardFigure', character.images.standardFigure)
  addImage('heroImage', character.images.heroImage)
  addImage('portrait', character.images.portrait)
  addImage('profileImage', character.images.profileImage)
  for (const image of character.images.additionalImages) {
    addImage('additional', image, image.type)
  }

  return images
}

const registerGameObjectsApi = (middlewares: MiddlewareStack): void => {
  const handler = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ): Promise<void> => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')
      const pathname = requestUrl.pathname
      const isRootPath = pathname === '/' || pathname === ''

      if (request.method === 'GET' && isRootPath) {
        const requestedType = requestUrl.searchParams.get('type')
        const objectType = toGameObjectType(requestedType)
        if (requestedType && !objectType) {
          json(response, 400, { error: 'type muss character, place, learning-goals oder artifact sein.' })
          return
        }

        const slug = requestUrl.searchParams.get('slug')?.trim() ?? ''
        const id = requestUrl.searchParams.get('id')?.trim() ?? ''

        if (id || slug) {
          const gameObject = id
            ? await gameObjectService.get(id)
            : objectType
              ? await gameObjectService.getBySlug(objectType, slug)
              : await gameObjectService.get(slug)

          if (!gameObject) {
            json(response, 404, { error: 'GameObject nicht gefunden.' })
            return
          }

          json(response, 200, { gameObject })
          return
        }

        const gameObjects = objectType
          ? await gameObjectService.listByType(objectType)
          : await gameObjectService.listAll()
        json(response, 200, { gameObjects })
        return
      }

      if (request.method === 'GET' && pathname.endsWith('/relationships')) {
        const rawId = decodePathSegment(pathname.replace(/\/relationships$/, '').replace(/^\//, ''))
        if (!rawId) {
          json(response, 400, { error: 'id ist erforderlich.' })
          return
        }

        const gameObject = await gameObjectService.get(rawId)
        if (!gameObject) {
          json(response, 404, { error: 'GameObject nicht gefunden.' })
          return
        }

        json(response, 200, {
          gameObject,
          relationships: await listRelationshipsForObject(gameObject.id),
        })
        return
      }

      if (request.method === 'GET' && pathname.endsWith('/images')) {
        const rawId = decodePathSegment(pathname.replace(/\/images$/, '').replace(/^\//, ''))
        if (!rawId) {
          json(response, 400, { error: 'id ist erforderlich.' })
          return
        }

        const gameObject = await gameObjectService.get(rawId)
        if (!gameObject) {
          json(response, 404, { error: 'GameObject nicht gefunden.' })
          return
        }

        json(response, 200, {
          gameObject: {
            id: gameObject.id,
            slug: gameObject.slug,
            type: gameObject.type,
            name: gameObject.name,
          },
          images: listGameObjectImages(gameObject),
        })
        return
      }

      if (request.method === 'GET' && pathname.startsWith('/')) {
        const rawId = decodePathSegment(pathname.slice(1))
        if (!rawId) {
          json(response, 400, { error: 'id ist erforderlich.' })
          return
        }

        const gameObject = await gameObjectService.get(rawId)
        if (!gameObject) {
          json(response, 404, { error: 'GameObject nicht gefunden.' })
          return
        }

        json(response, 200, { gameObject })
        return
      }

      next()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode = message.includes('erforderlich') ? 400 : 500
      json(response, statusCode, { error: message })
    }
  }

  middlewares.use('/api/game-objects', handler)
  middlewares.use('/api/gameobjects', handler)
}

export const gameObjectsApiPlugin = (): Plugin => ({
  name: 'storytime-game-objects-api',
  configureServer(server) {
    registerGameObjectsApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerGameObjectsApi(server.middlewares)
  },
})
