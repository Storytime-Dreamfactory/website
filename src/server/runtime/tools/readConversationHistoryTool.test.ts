import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listActivitiesMock: vi.fn(),
  getConversationDetailsMock: vi.fn(),
  trackRuntimeToolActivitySafelyMock: vi.fn(),
  trackTraceActivitySafelyMock: vi.fn(),
}))

vi.mock('../../activityStore.ts', () => ({
  listActivities: mocks.listActivitiesMock,
}))

vi.mock('../../conversationStore.ts', () => ({
  getConversationDetails: mocks.getConversationDetailsMock,
}))

vi.mock('./runtimeToolActivityLogger.ts', () => ({
  trackRuntimeToolActivitySafely: mocks.trackRuntimeToolActivitySafelyMock,
}))

vi.mock('../../traceActivity.ts', () => ({
  trackTraceActivitySafely: mocks.trackTraceActivitySafelyMock,
}))

import { readConversationHistoryTool } from './readConversationHistoryTool.ts'

describe('readConversationHistoryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.trackRuntimeToolActivitySafelyMock.mockResolvedValue(undefined)
    mocks.trackTraceActivitySafelyMock.mockResolvedValue(undefined)
  })

  it('liest relevante Conversations und liefert Bild- sowie Objekt-IDs', async () => {
    mocks.listActivitiesMock.mockResolvedValue([
      { conversationId: 'conv-1' },
      { conversationId: 'conv-2' },
    ])
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: 'nola',
        startedAt: '2026-01-01T10:00:00.000Z',
      },
      messages: [
        {
          messageId: 1,
          role: 'assistant',
          content: 'Schau mal!',
          eventType: 'response.audio_transcript.done',
          createdAt: '2026-01-01T10:01:00.000Z',
          metadata: {
            imageUrl: '/content/conversations/conv-1/recalled-1.jpg',
            imageAssetPath: 'public/content/conversations/conv-1/recalled-1.jpg',
            scenePrompt: 'Eiffelturm am Fluss',
            object: { type: 'image', id: 'img-eiffel' },
          },
        },
      ],
    })

    const result = await readConversationHistoryTool.execute(
      {
        conversationId: 'conv-1',
        characterId: 'nola',
        characterName: 'Nola',
      },
      {
        scope: 'external',
        limit: 200,
        offset: 0,
      },
    )

    expect(mocks.listActivitiesMock).toHaveBeenCalled()
    expect(result.scope).toBe('external')
    expect(result.conversations[0]).toEqual(
      expect.objectContaining({
        conversationId: 'conv-1',
      }),
    )
    expect(result.conversations[0].messages[0]).toEqual(
      expect.objectContaining({
        messageId: 1,
        imageRefs: expect.objectContaining({
          imageId: 'recalled-1',
          imageUrl: '/content/conversations/conv-1/recalled-1.jpg',
        }),
        objectRefs: expect.arrayContaining([
          expect.objectContaining({ objectType: 'image', objectId: 'img-eiffel' }),
        ]),
      }),
    )
    expect(result.conversations[0].imageCandidates[0]).toEqual(
      expect.objectContaining({
        imageId: 'recalled-1',
      }),
    )
  })
})
