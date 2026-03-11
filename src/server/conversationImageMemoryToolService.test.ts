import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createActivityMock: vi.fn(),
  listActivitiesMock: vi.fn(),
  appendConversationMessageMock: vi.fn(),
  getConversationDetailsMock: vi.fn(),
  loadCharacterRuntimeProfileMock: vi.fn(),
  storeConversationImageAssetMock: vi.fn(),
  resolveCharacterImageRefsMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('./activityStore.ts', () => ({
  createActivity: mocks.createActivityMock,
  listActivities: mocks.listActivitiesMock,
}))

vi.mock('./conversationStore.ts', () => ({
  appendConversationMessage: mocks.appendConversationMessageMock,
  getConversationDetails: mocks.getConversationDetailsMock,
}))

vi.mock('./runtimeContentStore.ts', () => ({
  loadCharacterRuntimeProfile: mocks.loadCharacterRuntimeProfileMock,
}))

vi.mock('./conversationImageAssetStore.ts', () => ({
  storeConversationImageAsset: mocks.storeConversationImageAssetMock,
}))

vi.mock('./runtime/context/contextCollationService.ts', () => ({
  resolveCharacterImageRefs: mocks.resolveCharacterImageRefsMock,
}))

import { recallConversationImage } from './conversationImageMemoryToolService.ts'

describe('recallConversationImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createActivityMock.mockResolvedValue({})
    mocks.listActivitiesMock.mockResolvedValue([])
    mocks.appendConversationMessageMock.mockResolvedValue({})
    mocks.storeConversationImageAssetMock.mockResolvedValue({
      localUrl: '/content/conversations/conv-1/recalled-1.jpg',
      localFilePath: '/tmp/recalled-1.jpg',
      originalUrl: 'https://example.com/beach.jpg',
      format: 'jpeg',
    })
    mocks.loadCharacterRuntimeProfileMock.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Yoko',
      species: 'Mensch',
      shortDescription: '',
      coreTraits: [],
      suitableLearningGoalIds: [],
    })
    mocks.resolveCharacterImageRefsMock.mockResolvedValue([
      { kind: 'hero', title: 'Hero', path: '/content/characters/yoko/hero-image.jpg' },
    ])
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: { learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'] },
      },
      messages: [
        {
          role: 'system',
          conversationId: 'conv-1',
          content: 'Yoko zeigt ein neues Bild: Waldszene',
          metadata: {
            imageUrl: 'https://example.com/forest.jpg',
            sceneSummary: 'Wald mit kleinem See',
          },
        },
        {
          role: 'system',
          conversationId: 'conv-1',
          content: 'Yoko zeigt ein neues Bild: Strand',
          metadata: {
            imageUrl: 'https://example.com/beach.jpg',
            sceneSummary: 'Strand bei Sonnenuntergang',
          },
        },
      ],
    })
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    mocks.fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: 'Yoko steht am Strand und die Sonne geht warm unter.',
      }),
    })
    vi.stubGlobal('fetch', mocks.fetchMock)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('findet query-passendes Bild und loggt recall-Events', async () => {
    const result = await recallConversationImage({
      conversationId: 'conv-1',
      queryText: 'Kannst du nochmal das Strand-Bild zeigen?',
      source: 'api',
    })

    expect(result).toEqual({
      imageUrl: '/content/conversations/conv-1/recalled-1.jpg',
      sceneSummary: 'Strand bei Sonnenuntergang',
      reason: 'query_match',
    })
    expect(mocks.appendConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        eventType: 'tool.image.recalled',
        content: 'Yoko zeigte noch einmal ein Bild: Yoko steht am Strand und die Sonne geht warm unter.',
        metadata: expect.objectContaining({
          heroImageUrl: '/content/conversations/conv-1/recalled-1.jpg',
          imageVisualSummary: 'Yoko steht am Strand und die Sonne geht warm unter.',
        }),
      }),
    )
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'tool.image.recalled',
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'conversation.image.recalled',
        isPublic: true,
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'trace.tool.show_image.request',
        isPublic: false,
        metadata: expect.objectContaining({
          traceStage: 'tool',
          traceKind: 'request',
        }),
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'trace.tool.show_image.response',
        isPublic: false,
        metadata: expect.objectContaining({
          traceStage: 'tool',
          traceKind: 'response',
          ok: true,
        }),
      }),
    )
  })

  it('sucht global ueber Character-Conversations und matched Personenbezug', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: { learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'] },
      },
      messages: [
        {
          role: 'system',
          conversationId: 'conv-1',
          createdAt: '2026-03-08T16:40:00.000Z',
          content: 'Yoko zeigt ein neues Bild mit Fluss',
          metadata: {
            imageUrl: 'https://example.com/river.jpg',
            sceneSummary: 'Ruhiger Fluss mit Boot',
          },
        },
      ],
    })
    mocks.listActivitiesMock
      .mockResolvedValueOnce([
        {
          activityId: 'a-generated-1',
          activityType: 'conversation.image.generated',
          characterId: '00000000-0000-4000-8000-000000000001',
          conversationId: 'conv-old-juna',
          isPublic: true,
          learningGoalIds: [],
          subject: {},
          object: { url: 'https://example.com/juna.jpg' },
          metadata: {
            summary: 'Yoko und Juna spielen am Wasser',
            sceneSummary: 'Yoko mit Juna am Fluss',
            relatedCharacterNames: ['Juna'],
          },
          occurredAt: '2026-03-01T10:00:00.000Z',
          createdAt: '2026-03-01T10:00:01.000Z',
        },
      ])
      .mockResolvedValueOnce([])

    const result = await recallConversationImage({
      conversationId: 'conv-1',
      queryText: 'Hast du was mit Juna?',
      source: 'runtime',
    })

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'query_match',
      }),
    )
    expect(mocks.listActivitiesMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        characterId: '00000000-0000-4000-8000-000000000001',
        activityType: 'conversation.image.generated',
        limit: 300,
      }),
    )
    expect(mocks.appendConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceConversationId: 'conv-old-juna',
          recallReason: 'query_match',
        }),
      }),
    )
  })

  it('respektiert strict preferredImageUrl und faellt nicht auf latest zurueck', async () => {
    const result = await recallConversationImage({
      conversationId: 'conv-1',
      queryText: 'Zeig das alte Bild',
      preferredImageUrl: 'https://example.com/forest.jpg',
      source: 'runtime',
    })

    expect(result).toEqual(
      expect.objectContaining({
        reason: 'query_match',
      }),
    )
    expect(mocks.storeConversationImageAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: 'https://example.com/forest.jpg',
      }),
    )
  })

  it('faellt auf Charakterbild zurueck, wenn keine Erinnerungsbilder vorhanden sind', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: { learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'] },
      },
      messages: [],
    })
    mocks.listActivitiesMock.mockResolvedValue([])

    const result = await recallConversationImage({
      conversationId: 'conv-1',
      queryText: 'Zeig mir ein Bild',
      source: 'runtime',
    })

    expect(result).toEqual(
      expect.objectContaining({
        imageUrl: '/content/conversations/conv-1/recalled-1.jpg',
        reason: 'latest',
      }),
    )
    expect(mocks.storeConversationImageAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: '/content/characters/yoko/hero-image.jpg',
      }),
    )
  })
})
