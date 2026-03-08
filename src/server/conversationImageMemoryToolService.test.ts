import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createActivityMock: vi.fn(),
  listActivitiesMock: vi.fn(),
  appendConversationMessageMock: vi.fn(),
  getConversationDetailsMock: vi.fn(),
  loadCharacterRuntimeProfileMock: vi.fn(),
  storeConversationImageAssetMock: vi.fn(),
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
      id: 'yoko',
      name: 'Yoko',
      species: 'Mensch',
      shortDescription: '',
      coreTraits: [],
      suitableLearningGoalIds: [],
    })
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: 'yoko',
        metadata: { learningGoalIds: ['kindness'] },
      },
      messages: [
        {
          role: 'system',
          conversationId: 'conv-1',
          content: 'Yoko zeigt ein neues Bild: Waldszene',
          metadata: {
            imageUrl: 'https://example.com/forest.jpg',
            scenePrompt: 'Wald mit kleinem See',
          },
        },
        {
          role: 'system',
          conversationId: 'conv-1',
          content: 'Yoko zeigt ein neues Bild: Strand',
          metadata: {
            imageUrl: 'https://example.com/beach.jpg',
            scenePrompt: 'Strand bei Sonnenuntergang',
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
      scenePrompt: 'Strand bei Sonnenuntergang',
      reason: 'query_match',
    })
    expect(mocks.appendConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        eventType: 'tool.image.recalled',
        content: expect.stringContaining('Darauf zu sehen: Yoko steht am Strand'),
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
  })
})
