import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

const mocks = vi.hoisted(() => ({
  getMock: vi.fn(),
  getBySlugMock: vi.fn(),
  listAllMock: vi.fn(),
  listByTypeMock: vi.fn(),
  listRelationshipsForObjectMock: vi.fn(),
}))

vi.mock('./gameObjectService.ts', () => ({
  get: mocks.getMock,
  getBySlug: mocks.getBySlugMock,
  listAll: mocks.listAllMock,
  listByType: mocks.listByTypeMock,
}))

vi.mock('./relationshipStore.ts', () => ({
  listRelationshipsForObject: mocks.listRelationshipsForObjectMock,
}))

import { gameObjectsApiPlugin } from './gameObjectsPlugin.ts'

type CapturedHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void | Promise<void>

const registerPluginAndCaptureHandlers = (): CapturedHandler[] => {
  const handlers: CapturedHandler[] = []
  const plugin = gameObjectsApiPlugin()
  const pluginContext = {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    meta: {},
  } as any
  const server = {
    middlewares: {
      use: (_route: string, registered: CapturedHandler) => {
        handlers.push(registered)
      },
    },
  } as any
  const configureServer = plugin.configureServer
  if (typeof configureServer === 'function') {
    configureServer.call(pluginContext, server)
  } else if (configureServer && typeof configureServer === 'object') {
    configureServer.handler.call(pluginContext, server)
  }
  return handlers
}

const createResponse = () => {
  const store = {
    headers: new Map<string, string>(),
    body: '',
  }
  const response = {
    statusCode: 200,
    setHeader: (key: string, value: string) => {
      store.headers.set(key, value)
    },
    end: (payload?: string) => {
      store.body = payload ?? ''
    },
  } as unknown as ServerResponse
  return { response, store }
}

describe('gameObjectsApiPlugin', () => {
  it('liefert ein Objekt per UUID oder Slug', async () => {
    const [handler] = registerPluginAndCaptureHandlers()
    mocks.getMock.mockResolvedValue({
      id: '78a52cad-30b5-468f-9687-c50c30a4bd39',
      slug: 'flora-blumenfreude',
      type: 'character',
      name: 'Flora Blumenfreude',
    })

    const { response, store } = createResponse()
    await handler(
      { method: 'GET', url: '/78a52cad-30b5-468f-9687-c50c30a4bd39' } as IncomingMessage,
      response,
      () => undefined,
    )

    expect((response as any).statusCode).toBe(200)
    expect(store.body).toContain('"id":"78a52cad-30b5-468f-9687-c50c30a4bd39"')
    expect(mocks.getMock).toHaveBeenCalledWith('78a52cad-30b5-468f-9687-c50c30a4bd39')
  })

  it('listet Objekte nach Typ', async () => {
    const [handler] = registerPluginAndCaptureHandlers()
    mocks.listByTypeMock.mockResolvedValue([
      {
        id: '78a52cad-30b5-468f-9687-c50c30a4bd39',
        slug: 'flora-blumenfreude',
        type: 'character',
        name: 'Flora Blumenfreude',
      },
    ])

    const { response, store } = createResponse()
    await handler(
      { method: 'GET', url: '/?type=character' } as IncomingMessage,
      response,
      () => undefined,
    )

    expect((response as any).statusCode).toBe(200)
    expect(store.body).toContain('"gameObjects"')
    expect(mocks.listByTypeMock).toHaveBeenCalledWith('character')
  })

  it('liefert Relationships nur ueber die kanonische UUID', async () => {
    const [handler] = registerPluginAndCaptureHandlers()
    mocks.getMock.mockResolvedValue({
      id: '78a52cad-30b5-468f-9687-c50c30a4bd39',
      slug: 'flora-blumenfreude',
      type: 'character',
      name: 'Flora Blumenfreude',
    })
    mocks.listRelationshipsForObjectMock.mockResolvedValueOnce([
      {
        relationshipId: '78a52cad-30b5-468f-9687-c50c30a4bd39#8eb40291-65ee-49b6-b826-d7c7e97404c0#freundin',
        source: {
          id: '78a52cad-30b5-468f-9687-c50c30a4bd39',
          slug: 'flora-blumenfreude',
          type: 'character',
          name: 'Flora Blumenfreude',
        },
        target: {
          id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
          slug: 'nola',
          type: 'character',
          name: 'Nola',
        },
        relationshipType: 'freundin',
        relationshipTypeReadable: 'Freundin',
        relationship: 'Freundin',
        direction: 'outgoing',
        otherRelatedObjects: [],
      },
    ])

    const { response, store } = createResponse()
    await handler(
      { method: 'GET', url: '/78a52cad-30b5-468f-9687-c50c30a4bd39/relationships' } as IncomingMessage,
      response,
      () => undefined,
    )

    expect((response as any).statusCode).toBe(200)
    expect(store.body).toContain('"relationships"')
    expect(store.body).toContain('"id":"78a52cad-30b5-468f-9687-c50c30a4bd39"')
    expect(mocks.listRelationshipsForObjectMock).toHaveBeenCalledTimes(1)
    expect(mocks.listRelationshipsForObjectMock).toHaveBeenCalledWith(
      '78a52cad-30b5-468f-9687-c50c30a4bd39',
    )
  })

  it('liefert Character-Bilder ueber einen dedizierten Endpunkt', async () => {
    const [handler] = registerPluginAndCaptureHandlers()
    mocks.getMock.mockResolvedValue({
      id: '78a52cad-30b5-468f-9687-c50c30a4bd39',
      slug: 'flora-blumenfreude',
      type: 'character',
      name: 'Flora Blumenfreude',
      images: {
        standardFigure: {
          file: '/content/characters/flora-blumenfreude/standard-figur.png',
          description: 'Standardfigur',
        },
        heroImage: {
          file: '/content/characters/flora-blumenfreude/hero-image.jpg',
          description: 'Hero',
        },
        portrait: {
          file: '/content/characters/flora-blumenfreude/portrait.png',
          description: 'Portrait',
        },
        profileImage: {
          file: '/content/characters/flora-blumenfreude/profilbild.png',
          description: 'Profil',
        },
        additionalImages: [
          {
            type: 'emotion_happy',
            file: '/content/characters/flora-blumenfreude/emotion-happy.png',
            description: 'Happy',
          },
        ],
      },
    })

    const { response, store } = createResponse()
    await handler(
      { method: 'GET', url: '/78a52cad-30b5-468f-9687-c50c30a4bd39/images' } as IncomingMessage,
      response,
      () => undefined,
    )

    expect((response as any).statusCode).toBe(200)
    expect(store.body).toContain('"images"')
    expect(store.body).toContain('"slot":"heroImage"')
    expect(store.body).toContain('"type":"emotion_happy"')
    expect(store.body).toContain('/content/characters/flora-blumenfreude/hero-image.jpg')
  })
})
