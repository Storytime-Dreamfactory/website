import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createCharacterDraftMock = vi.hoisted(() => vi.fn())
const saveCharacterYamlMock = vi.hoisted(() => vi.fn())
const generateCharacterImagesMock = vi.hoisted(() => vi.fn())
const loadWorldContextMock = vi.hoisted(() => vi.fn())
const invalidateCacheMock = vi.hoisted(() => vi.fn())

vi.mock('./createCharacterDraft.ts', () => ({
  createCharacterDraft: createCharacterDraftMock,
}))

vi.mock('./saveCharacterYaml.ts', () => ({
  saveCharacterYaml: saveCharacterYamlMock,
}))

vi.mock('./generateCharacterImages.ts', () => ({
  generateCharacterImages: generateCharacterImagesMock,
}))

vi.mock('./loadWorldContext.ts', () => ({
  loadWorldContext: loadWorldContextMock,
}))

vi.mock('../../../src/server/gameObjectService.ts', () => ({
  invalidateCache: invalidateCacheMock,
}))

import { characterCreatorApiPlugin } from './localApiPlugin.ts'

type CapturedHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void | Promise<void>

const registerPluginAndCaptureHandlers = (): CapturedHandler[] => {
  const handlers: CapturedHandler[] = []
  const plugin = characterCreatorApiPlugin()
  const server = {
    middlewares: {
      use: (_route: string, registered: CapturedHandler) => {
        handlers.push(registered)
      },
    },
  }
  const configureServer = plugin.configureServer
  if (typeof configureServer === 'function') {
    configureServer.call({} as never, server as never)
  } else if (configureServer && typeof configureServer === 'object') {
    configureServer.handler.call({} as never, server as never)
  }
  return handlers
}

const createJsonRequest = (
  method: string,
  url: string,
  body?: Record<string, unknown>,
): IncomingMessage => {
  const payload = body ? Buffer.from(JSON.stringify(body), 'utf8') : Buffer.from('', 'utf8')
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (payload.byteLength > 0) {
        yield payload
      }
    },
  } as IncomingMessage
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

describe('characterCreatorApiPlugin', () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY
  const originalBflKey = process.env.BFL_API_KEY
  const originalPollInterval = process.env.CHARACTER_CREATOR_POLL_INTERVAL_MS
  const originalMaxPollAttempts = process.env.CHARACTER_CREATOR_MAX_POLL_ATTEMPTS

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.OPENAI_API_KEY
    delete process.env.CHARACTER_CREATOR_POLL_INTERVAL_MS
    delete process.env.CHARACTER_CREATOR_MAX_POLL_ATTEMPTS
    process.env.BFL_API_KEY = 'test-bfl-key'
  })

  afterEach(() => {
    if (originalOpenAiKey == null) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey
    }
    if (originalBflKey == null) {
      delete process.env.BFL_API_KEY
    } else {
      process.env.BFL_API_KEY = originalBflKey
    }
    if (originalPollInterval == null) {
      delete process.env.CHARACTER_CREATOR_POLL_INTERVAL_MS
    } else {
      process.env.CHARACTER_CREATOR_POLL_INTERVAL_MS = originalPollInterval
    }
    if (originalMaxPollAttempts == null) {
      delete process.env.CHARACTER_CREATOR_MAX_POLL_ATTEMPTS
    } else {
      process.env.CHARACTER_CREATOR_MAX_POLL_ATTEMPTS = originalMaxPollAttempts
    }
  })

  it('bricht /start frueh ab, wenn ein Draft noetig ist aber OPENAI_API_KEY fehlt', async () => {
    const [handler] = registerPluginAndCaptureHandlers()
    const { response, store } = createResponse()

    await handler(
      createJsonRequest('POST', '/start', {
        prompt: 'Ein mutiger Fuchs',
        fillMissingFieldsCreatively: false,
        referenceImageIds: [],
      }),
      response,
      () => undefined,
    )

    expect(response.statusCode).toBe(400)
    expect(store.body).toContain('OPENAI_API_KEY fehlt')
    expect(createCharacterDraftMock).not.toHaveBeenCalled()
  })

  it('liefert bei /reference-image nur Referenzdaten und startet keinen Job', async () => {
    const [handler] = registerPluginAndCaptureHandlers()
    const { response, store } = createResponse()

    await handler(
      createJsonRequest('POST', '/reference-image', {
        fileName: 'figur.png',
        dataUrl:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZxkQAAAAASUVORK5CYII=',
      }),
      response,
      () => undefined,
    )

    expect(response.statusCode).toBe(200)
    expect(store.body).toContain('"referenceImage"')
    expect(store.body).not.toContain('"jobId"')
  })

  it('nutzt flux-2-pro und Polling-Env-Werte fuer Character-Generierung', async () => {
    const [handler] = registerPluginAndCaptureHandlers()
    const { response } = createResponse()
    saveCharacterYamlMock.mockResolvedValue({
      characterId: '11111111-1111-1111-1111-111111111111',
      contentPath: '/tmp/character.yaml',
      normalizedYamlText: 'id: 11111111-1111-1111-1111-111111111111',
    })
    generateCharacterImagesMock.mockResolvedValue({
      manifestPath: '/tmp/generation-manifest.json',
      manifest: { assets: [] },
    })
    process.env.CHARACTER_CREATOR_POLL_INTERVAL_MS = '2100'
    process.env.CHARACTER_CREATOR_MAX_POLL_ATTEMPTS = '333'

    await handler(
      createJsonRequest('POST', '/start', {
        yamlText: 'id: 11111111-1111-1111-1111-111111111111',
      }),
      response,
      () => undefined,
    )

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(response.statusCode).toBe(202)
    expect(generateCharacterImagesMock).toHaveBeenCalledTimes(1)
    expect(generateCharacterImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultModel: 'flux-2-pro',
        heroModel: 'flux-2-pro',
        pollIntervalMs: 2100,
        maxPollAttempts: 333,
      }),
    )
  })
})
