import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  getStorytimeDbPoolMock: vi.fn(),
  gameObjectGetMock: vi.fn(),
}))

vi.mock('./dbPool.ts', () => ({
  getStorytimeDbPool: mocks.getStorytimeDbPoolMock,
}))

vi.mock('./openAiConfig.ts', () => ({
  getOpenAiApiKey: () => '',
  readServerEnv: (_key: string, fallback: string) => fallback,
}))

vi.mock('./gameObjectService.ts', () => ({
  get: mocks.gameObjectGetMock,
  getContextBatch: vi.fn(),
}))

describe('activityStore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.getStorytimeDbPoolMock.mockReturnValue({
      query: mocks.queryMock,
    })
  })

  it('findet legacy slug-activities auch bei UUID-Filtern', async () => {
    mocks.gameObjectGetMock.mockResolvedValue({
      id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
      slug: 'nola',
      type: 'character',
      name: 'Nola',
    })
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            activity_id: 'legacy-1',
            activity_type: 'conversation.image.generated',
            is_public: true,
            character_id: 'nola',
            place_id: null,
            learning_goal_ids: [],
            skill_ids: [],
            conversation_id: 'conv-1',
            subject: {},
            object: {},
            metadata: {},
            story_summary: null,
            occurred_at: '2026-03-10T09:00:00.000Z',
            created_at: '2026-03-10T09:00:00.000Z',
          },
        ],
      })

    const { listActivities } = await import('./activityStore.ts')
    const activities = await listActivities({
      characterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
      limit: 10,
    })

    expect(activities).toHaveLength(1)
    expect(activities[0]?.characterId).toBe('nola')

    const selectCall = mocks.queryMock.mock.calls[2]
    expect(String(selectCall[0])).toContain('character_id = ANY')
    expect(selectCall[1][0]).toEqual([
      '8eb40291-65ee-49b6-b826-d7c7e97404c0',
      'nola',
    ])
  })

  it('normalisiert slug-characterIds beim Schreiben auf die kanonische UUID', async () => {
    mocks.gameObjectGetMock.mockResolvedValue({
      id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
      slug: 'nola',
      type: 'character',
      name: 'Nola',
    })
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            activity_id: 'new-1',
            activity_type: 'conversation.message.created',
            is_public: true,
            character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
            place_id: null,
            learning_goal_ids: [],
            skill_ids: [],
            conversation_id: 'conv-2',
            subject: {},
            object: {},
            metadata: {},
            story_summary: null,
            occurred_at: '2026-03-10T09:05:00.000Z',
            created_at: '2026-03-10T09:05:00.000Z',
          },
        ],
      })

    const { createActivity } = await import('./activityStore.ts')
    const activity = await createActivity({
      activityType: 'conversation.message.created',
      isPublic: true,
      characterId: 'nola',
      conversationId: 'conv-2',
    })

    expect(activity.characterId).toBe('8eb40291-65ee-49b6-b826-d7c7e97404c0')

    const insertCall = mocks.queryMock.mock.calls[2]
    expect(insertCall[1][3]).toBe('8eb40291-65ee-49b6-b826-d7c7e97404c0')
  })
})
