import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'

const mocks = vi.hoisted(() => ({
  listRelationshipsByOtherRelatedObjectMock: vi.fn(),
}))

vi.mock('./relationshipStore.ts', async () => {
  const actual =
    await vi.importActual<typeof import('./relationshipStore.ts')>('./relationshipStore.ts')
  return {
    ...actual,
    listRelationshipsByOtherRelatedObject: mocks.listRelationshipsByOtherRelatedObjectMock,
  }
})

import { relationshipsApiPlugin } from './relationshipsPlugin.ts'

type CapturedHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void | Promise<void>

const registerPluginAndCaptureHandler = (): CapturedHandler => {
  let handler: CapturedHandler | undefined
  const plugin = relationshipsApiPlugin()
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
        handler = registered
      },
    },
  } as any
  const configureServer = plugin.configureServer
  if (typeof configureServer === 'function') {
    configureServer.call(pluginContext, server)
  } else if (configureServer && typeof configureServer === 'object') {
    configureServer.handler.call(pluginContext, server)
  }
  if (!handler) throw new Error('handler missing')
  return handler
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

describe('relationshipsPlugin /by-object', () => {
  it('liefert 400 ohne type/id', async () => {
    const handler = registerPluginAndCaptureHandler()

    const { response, store } = createResponse()
    await handler(
      { method: 'GET', url: '/by-object?id=abc' } as IncomingMessage,
      response,
      () => undefined,
    )

    expect((response as any).statusCode).toBe(400)
    expect(store.body).toContain('type ist erforderlich')
  })

  it('liefert Matches fuer object lookup', async () => {
    const handler = registerPluginAndCaptureHandler()

    mocks.listRelationshipsByOtherRelatedObjectMock.mockResolvedValue([
      {
        relationship: {
          relationshipId: 'nola#romi#freundin',
          sourceCharacterId: 'nola',
          targetCharacterId: 'romi',
          relationshipType: 'freundin',
          relationshipTypeReadable: 'Freundin',
          relationship: 'Freundin',
          description: undefined,
          metadata: {},
          otherRelatedObjects: [{ type: 'place', id: 'crystal-lake' }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        matchedObject: { type: 'place', id: 'crystal-lake' },
      },
    ])

    const { response, store } = createResponse()
    await handler(
      { method: 'GET', url: '/by-object?type=place&id=crystal-lake' } as IncomingMessage,
      response,
      () => undefined,
    )

    expect((response as any).statusCode).toBe(200)
    expect(store.body).toContain('"type":"place"')
    expect(store.body).toContain('"id":"crystal-lake"')
    expect(mocks.listRelationshipsByOtherRelatedObjectMock).toHaveBeenCalledWith(
      'place',
      'crystal-lake',
    )
  })
})
