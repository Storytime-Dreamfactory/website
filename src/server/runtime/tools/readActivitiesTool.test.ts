import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listActivitiesMock: vi.fn(),
  trackRuntimeToolActivitySafelyMock: vi.fn(),
  trackTraceActivitySafelyMock: vi.fn(),
}))

vi.mock('../../activityStore.ts', () => ({
  listActivities: mocks.listActivitiesMock,
}))

vi.mock('./runtimeToolActivityLogger.ts', () => ({
  trackRuntimeToolActivitySafely: mocks.trackRuntimeToolActivitySafelyMock,
}))

vi.mock('../../traceActivity.ts', () => ({
  trackTraceActivitySafely: mocks.trackTraceActivitySafelyMock,
}))

import { readActivitiesTool } from './readActivitiesTool.ts'

describe('readActivitiesTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.trackRuntimeToolActivitySafelyMock.mockResolvedValue(undefined)
    mocks.trackTraceActivitySafelyMock.mockResolvedValue(undefined)
  })

  it('liefert externen Activity-Stream mit IDs und Bildreferenzen', async () => {
    mocks.listActivitiesMock.mockResolvedValue([
      {
        activityId: 'a-1',
        activityType: 'conversation.image.recalled',
        isPublic: true,
        conversationId: 'conv-1',
        occurredAt: '2026-01-01T10:00:00.000Z',
        createdAt: '2026-01-01T10:00:00.000Z',
        object: { type: 'image', id: 'img-eiffel' },
        metadata: {
          summary: 'Nola zeigt ein Eiffelturm-Bild',
          imageUrl: '/content/conversations/conv-1/recalled-1.jpg',
          imageAssetPath: 'public/content/conversations/conv-1/recalled-1.jpg',
        },
      },
      {
        activityId: 'a-2',
        activityType: 'trace.tool.show_image.request',
        isPublic: true,
        conversationId: 'conv-1',
        occurredAt: '2026-01-01T09:59:00.000Z',
        createdAt: '2026-01-01T09:59:00.000Z',
        object: {},
        metadata: {},
      },
    ])

    const result = await readActivitiesTool.execute(
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

    expect(mocks.listActivitiesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        isPublic: true,
        limit: 200,
        offset: 0,
      }),
    )
    expect(result.activityCount).toBe(1)
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        activityId: 'a-1',
        conversationId: 'conv-1',
        objectId: 'img-eiffel',
        imageRefs: expect.objectContaining({
          imageId: 'recalled-1',
          imageUrl: '/content/conversations/conv-1/recalled-1.jpg',
        }),
      }),
    )
  })
})
