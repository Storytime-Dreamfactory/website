import { Readable } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  startConversationMock: vi.fn(),
  appendConversationMessageMock: vi.fn(),
  getConversationDetailsMock: vi.fn(),
  endConversationMock: vi.fn(),
  createActivityMock: vi.fn(),
  triggerConversationEndedServiceMock: vi.fn(),
  createConversationEndSummaryMock: vi.fn(),
  orchestrateCharacterRuntimeTurnMock: vi.fn(),
  trackTraceActivitySafelyMock: vi.fn(),
}))

vi.mock('./conversationStore.ts', () => ({
  startConversation: mocks.startConversationMock,
  appendConversationMessage: mocks.appendConversationMessageMock,
  getConversationDetails: mocks.getConversationDetailsMock,
  endConversation: mocks.endConversationMock,
}))

vi.mock('./activityStore.ts', () => ({
  createActivity: mocks.createActivityMock,
}))

vi.mock('./conversationLifecycleService.ts', () => ({
  triggerConversationEndedService: mocks.triggerConversationEndedServiceMock,
}))

vi.mock('./conversationEndSummaryService.ts', () => ({
  createConversationEndSummary: mocks.createConversationEndSummaryMock,
}))

vi.mock('./characterRuntimeOrchestrator.ts', () => ({
  orchestrateCharacterRuntimeTurn: mocks.orchestrateCharacterRuntimeTurnMock,
}))

vi.mock('./traceActivity.ts', () => ({
  trackTraceActivitySafely: mocks.trackTraceActivitySafelyMock,
}))

import { conversationsApiPlugin } from './conversationsPlugin.ts'

type MockResponse = {
  statusCode: number
  headers: Record<string, string>
  body: string
  setHeader: (name: string, value: string) => void
  end: (chunk?: string) => void
}

const createJsonRequest = (url: string, method: string, body: Record<string, unknown>) => {
  const request = Readable.from([JSON.stringify(body)]) as Readable & {
    url: string
    method: string
  }
  request.url = url
  request.method = method
  return request
}

const createMockResponse = (): MockResponse => ({
  statusCode: 0,
  headers: {},
  body: '',
  setHeader(name: string, value: string) {
    this.headers[name] = value
  },
  end(chunk?: string) {
    this.body = chunk ?? ''
  },
})

describe('conversationsApiPlugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createActivityMock.mockResolvedValue({})
    mocks.trackTraceActivitySafelyMock.mockResolvedValue(undefined)
    mocks.triggerConversationEndedServiceMock.mockResolvedValue(undefined)
    mocks.createConversationEndSummaryMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000003',
        startedAt: '2026-03-09T14:00:00.000Z',
        endedAt: '2026-03-09T14:05:00.000Z',
        metadata: {
          counterpartName: 'Yoko',
          storySummary: 'Flora und Yoko beschlossen gemeinsam ein neues Blumenabenteuer.',
        },
      },
      summary: 'Flora und Yoko beschlossen gemeinsam ein neues Blumenabenteuer.',
      publicHistory: [],
      publicActivitySummaries: [],
    })
    mocks.endConversationMock.mockResolvedValue({
      conversationId: 'conv-1',
      characterId: '00000000-0000-4000-8000-000000000003',
      startedAt: '2026-03-09T14:00:00.000Z',
      endedAt: '2026-03-09T14:05:00.000Z',
      metadata: {
        counterpartName: 'Yoko',
      },
    })
  })

  it('ruft beim Beenden den End-Summary-Service auf und antwortet mit der aktualisierten Conversation', async () => {
    let registeredHandler:
      | ((
          request: Readable & { url?: string; method?: string },
          response: MockResponse,
          next: (error?: unknown) => void,
        ) => void | Promise<void>)
      | null = null
    const plugin = conversationsApiPlugin()
    const configureServerHook = plugin.configureServer
    const configureServer =
      typeof configureServerHook === 'function'
        ? configureServerHook
        : configureServerHook?.handler
    configureServer?.call(
      {} as never,
      {
        middlewares: {
          use: (_route: string, handler: typeof registeredHandler) => {
            registeredHandler = handler
          },
        },
      } as never,
    )

    expect(registeredHandler).toBeTypeOf('function')
    const request = createJsonRequest('/end', 'POST', {
      conversationId: 'conv-1',
      metadata: { endReason: 'manual-close' },
    })
    const response = createMockResponse()
    const next = vi.fn()

    await registeredHandler!(request, response, next)

    expect(mocks.endConversationMock).toHaveBeenCalledWith('conv-1', {
      metadata: { endReason: 'manual-close' },
    })
    expect(mocks.createConversationEndSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'conversation.ended',
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'character.chat.completed',
        metadata: expect.objectContaining({
          storySummary: 'Flora und Yoko beschlossen gemeinsam ein neues Blumenabenteuer.',
        }),
      }),
    )
    expect(mocks.triggerConversationEndedServiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        metadata: expect.objectContaining({
          storySummary: 'Flora und Yoko beschlossen gemeinsam ein neues Blumenabenteuer.',
        }),
      }),
    )
    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      conversation: expect.objectContaining({
        conversationId: 'conv-1',
        metadata: expect.objectContaining({
          storySummary: 'Flora und Yoko beschlossen gemeinsam ein neues Blumenabenteuer.',
        }),
      }),
    })
    expect(next).not.toHaveBeenCalled()
  })
})
