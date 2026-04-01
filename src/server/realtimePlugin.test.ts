import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getConversationDetailsMock: vi.fn(),
  gameObjectGetMock: vi.fn(),
  readActivitiesExecuteMock: vi.fn(),
  readRelationshipsExecuteMock: vi.fn(),
  readRelatedObjectsExecuteMock: vi.fn(),
}))

vi.mock('./conversationStore.ts', () => ({
  getConversationDetails: mocks.getConversationDetailsMock,
}))

vi.mock('./gameObjectService.ts', () => ({
  get: mocks.gameObjectGetMock,
}))

vi.mock('./runtime/tools/runtimeToolRegistry.ts', () => ({
  readActivitiesRuntimeTool: () => ({
    execute: mocks.readActivitiesExecuteMock,
  }),
  readRelationshipsRuntimeTool: () => ({
    execute: mocks.readRelationshipsExecuteMock,
  }),
  readRelatedObjectsRuntimeTool: () => ({
    execute: mocks.readRelatedObjectsExecuteMock,
  }),
}))

import { realtimeApiPlugin } from './realtimePlugin.ts'

type CapturedHandler = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void | Promise<void>

const registerPluginAndCaptureHandler = (): CapturedHandler => {
  let handler: CapturedHandler | undefined
  const plugin = realtimeApiPlugin()
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

const createJsonRequest = (url: string, body: Record<string, unknown>) =>
  Object.assign(Readable.from([JSON.stringify(body)]), {
    method: 'POST',
    url,
  }) as IncomingMessage

describe('realtimePlugin tool-call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-now',
        characterId: 'char-1',
        metadata: {
          learningGoalIds: ['goal-1'],
        },
      },
      messages: [],
    })
    mocks.gameObjectGetMock.mockResolvedValue({
      id: 'char-1',
      type: 'character',
      name: 'Yoko',
    })
    mocks.readActivitiesExecuteMock.mockResolvedValue({
      activityCount: 2,
      items: [
        {
          activityId: 'a-old',
          activityType: 'conversation.image.generated',
          conversationId: 'conv-old',
          occurredAt: '2026-03-01T10:00:00.000Z',
          summary: 'Fruehere Szene am See',
          storySummary: 'Yoko stand frueher am See.',
          imageRefs: { imageId: 'img-old' },
        },
        {
          activityId: 'a-now',
          activityType: 'conversation.image.recalled',
          conversationId: 'conv-now',
          occurredAt: '2026-03-02T10:00:00.000Z',
          summary: 'Aktuelle Erinnerung',
          storySummary: 'Yoko erinnert sich an das Bild.',
          imageRefs: { imageId: 'img-now' },
        },
      ],
    })
    mocks.readRelationshipsExecuteMock.mockResolvedValue({
      relationshipCount: 1,
      relatedCharacterIds: ['char-2'],
      relationshipLinks: [
        {
          relatedCharacterId: 'char-2',
          direction: 'outgoing',
          relationshipType: 'freundin',
          relationshipTypeReadable: 'Freundin',
          relationship: 'Freundin',
          otherRelatedObjects: [],
        },
      ],
    })
    mocks.readRelatedObjectsExecuteMock.mockResolvedValue({
      relatedObjectCount: 1,
      relatedObjects: [
        {
          objectType: 'character',
          objectId: 'char-2',
          displayName: 'Nola',
          imageRefs: [],
        },
      ],
    })
  })

  it('liefert read_activities im Tool-Call charakterweit und mit conversationId zurueck', async () => {
    const handler = registerPluginAndCaptureHandler()
    const { response, store } = createResponse()

    await handler(
      createJsonRequest('/tool-call', {
        characterId: 'char-1',
        conversationId: 'conv-now',
        toolName: 'read_activities',
        arguments: { limit: 7 },
      }),
      response,
      () => undefined,
    )

    expect((response as any).statusCode).toBe(200)
    expect(mocks.readActivitiesExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        conversationId: 'conv-now',
        learningGoalIds: ['goal-1'],
      }),
      expect.objectContaining({
        limit: 7,
        offset: 0,
        fetchAll: false,
        scope: 'external',
      }),
    )
    const toolArgs = mocks.readActivitiesExecuteMock.mock.calls[0]?.[1]
    expect(toolArgs).not.toHaveProperty('conversationId')
    expect(store.body).toContain('"conversationId":"conv-old"')
    expect(store.body).toContain('"conversationId":"conv-now"')
  })

  it('verkettet read_relationships im Tool-Call mit related objects', async () => {
    const handler = registerPluginAndCaptureHandler()
    const { response, store } = createResponse()

    await handler(
      createJsonRequest('/tool-call', {
        characterId: 'char-1',
        conversationId: 'conv-now',
        toolName: 'read_relationships',
        arguments: {},
      }),
      response,
      () => undefined,
    )

    expect((response as any).statusCode).toBe(200)
    expect(mocks.readRelationshipsExecuteMock).toHaveBeenCalledTimes(1)
    expect(mocks.readRelatedObjectsExecuteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: 'char-1',
        conversationId: 'conv-now',
      }),
      expect.objectContaining({
        relatedCharacterIds: ['char-2'],
        relationshipLinks: expect.any(Array),
      }),
    )
    expect(store.body).toContain('"relationshipCount":1')
    expect(store.body).toContain('"displayName":"Nola"')
  })
})
import { describe, expect, it } from 'vitest'
import {
  buildVoiceProfileInstructionsBlock,
  resolveRealtimeVoiceFromCharacterYaml,
} from './realtimePlugin.ts'

describe('realtimePlugin voice wiring', () => {
  it('resolves allowed voice from character yaml', () => {
    const voice = resolveRealtimeVoiceFromCharacterYaml({ voice: 'marin' })
    expect(voice).toBe('marin')
  })

  it('falls back to coral for invalid voice', () => {
    const voice = resolveRealtimeVoiceFromCharacterYaml({ voice: 'invalid-voice' })
    expect(voice).toBe('coral')
  })

  it('builds instruction block with injected voice profile fields', () => {
    const block = buildVoiceProfileInstructionsBlock({
      voice_profile: {
        identity: 'Freundliche Entdeckerin',
        demeanor: 'ermutigend',
        tone: 'warm',
        enthusiasm_level: 'hoch',
        formality_level: 'locker',
        emotion_level: 'ausdrucksstark',
        filler_words: 'occasionally',
        pacing: 'lebendig',
      },
    })

    expect(block).toContain('Identitaet: Freundliche Entdeckerin')
    expect(block).toContain('Grundhaltung: ermutigend')
  })
})
