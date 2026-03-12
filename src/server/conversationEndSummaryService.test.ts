import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createActivityMock: vi.fn(),
  listActivitiesMock: vi.fn(),
  getConversationDetailsMock: vi.fn(),
  mergeConversationMetadataMock: vi.fn(),
  getOpenAiApiKeyMock: vi.fn(),
}))

vi.mock('./activityStore.ts', () => ({
  createActivity: mocks.createActivityMock,
  listActivities: mocks.listActivitiesMock,
}))

vi.mock('./conversationStore.ts', () => ({
  getConversationDetails: mocks.getConversationDetailsMock,
  mergeConversationMetadata: mocks.mergeConversationMetadataMock,
}))

vi.mock('./openAiConfig.ts', () => ({
  getOpenAiApiKey: mocks.getOpenAiApiKeyMock,
  readServerEnv: (_key: string, fallback: string) => fallback,
}))

import { createConversationEndSummary } from './conversationEndSummaryService.ts'

describe('createConversationEndSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createActivityMock.mockResolvedValue({ activityId: 'a-summary' })
    mocks.getOpenAiApiKeyMock.mockReturnValue('test-key')
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000003',
        metadata: {
          counterpartName: 'Yoko',
          placeId: '00000000-0000-4000-8000-000000000006',
        },
      },
      messages: [
        {
          messageId: 1,
          conversationId: 'conv-1',
          role: 'user',
          content: 'Kannst du eine Zauberblume machen?',
          createdAt: '2026-03-09T14:00:00.000Z',
        },
        {
          messageId: 2,
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Ja, ich sammle schon Farben.',
          eventType: 'response.audio_transcript.done',
          createdAt: '2026-03-09T14:00:01.000Z',
        },
        {
          messageId: 3,
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'hidden',
          eventType: 'runtime.scene_flow.unavailable',
          createdAt: '2026-03-09T14:00:02.000Z',
        },
      ],
    })
    mocks.listActivitiesMock.mockImplementation(async (input: {
      conversationId?: string
      characterId?: string
      isPublic?: boolean
      offset?: number
    }) => {
      if ((input.offset ?? 0) > 0) return []
      if (input.conversationId === 'conv-1' && input.isPublic === true) {
        return [
          {
            activityId: 'img-1',
            activityType: 'conversation.image.generated',
            isPublic: true,
            conversationId: 'conv-1',
            characterId: '00000000-0000-4000-8000-000000000003',
            occurredAt: '2026-03-09T14:00:03.000Z',
            createdAt: '2026-03-09T14:00:03.000Z',
            subject: {},
            object: {},
            metadata: {
              summary: 'Flora liess eine leuchtende Blume ueber der Wiese erbluehen.',
            },
          },
          {
            activityId: 'msg-public',
            activityType: 'conversation.message.created',
            isPublic: true,
            conversationId: 'conv-1',
            characterId: '00000000-0000-4000-8000-000000000003',
            occurredAt: '2026-03-09T14:00:04.000Z',
            createdAt: '2026-03-09T14:00:04.000Z',
            subject: {},
            object: {},
            metadata: {
              summary: 'Yoko: Das ist schoen.',
            },
          },
        ]
      }
      if (input.characterId === '00000000-0000-4000-8000-000000000003' && input.isPublic === true) {
        return [
          {
            activityId: 'old-story',
            activityType: 'conversation.image.recalled',
            isPublic: true,
            conversationId: 'conv-old',
            characterId: '00000000-0000-4000-8000-000000000003',
            occurredAt: '2026-03-08T14:00:00.000Z',
            createdAt: '2026-03-08T14:00:00.000Z',
            subject: {},
            object: {},
            metadata: {},
            storySummary: 'Flora erinnerte sich an eine alte Blumenwiese.',
          },
        ]
      }
      return []
    })
    mocks.mergeConversationMetadataMock.mockResolvedValue({
      conversationId: 'conv-1',
      characterId: '00000000-0000-4000-8000-000000000003',
      startedAt: '2026-03-09T14:00:00.000Z',
      endedAt: '2026-03-09T14:05:00.000Z',
      metadata: {
        counterpartName: 'Yoko',
        placeId: '00000000-0000-4000-8000-000000000006',
        storySummary: 'Flora und Yoko liessen gemeinsam eine Zauberblume entstehen.',
        storySummarySource: 'conversation-end-service',
      },
    })
  })

  it('verdichtet oeffentliche Historie, persistiert die Summary und publiziert eine Activity', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'Flora und Yoko liessen gemeinsam eine Zauberblume entstehen.',
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const result = await createConversationEndSummary({
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000003',
        startedAt: '2026-03-09T14:00:00.000Z',
        endedAt: '2026-03-09T14:05:00.000Z',
        metadata: {
          counterpartName: 'Yoko',
          placeId: '00000000-0000-4000-8000-000000000006',
        },
      })

      expect(mocks.mergeConversationMetadataMock).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        metadata: {
          storySummary: 'Flora und Yoko liessen gemeinsam eine Zauberblume entstehen.',
          storySummarySource: 'conversation-end-service',
        },
      })
      expect(mocks.createActivityMock).toHaveBeenCalledWith(
        expect.objectContaining({
          activityType: 'conversation.story.summarized',
          isPublic: true,
          conversationId: 'conv-1',
          metadata: expect.objectContaining({
            summary: 'Flora und Yoko liessen gemeinsam eine Zauberblume entstehen.',
            summarySource: 'conversation-end-service',
            conversationLinkLabel: 'View Full Conversation',
            publicMessageCount: 2,
            publicActivityCount: 1,
          }),
        }),
      )
      const firstRequest = fetchMock.mock.calls[0]?.[1]
      const parsedBody = JSON.parse(String(firstRequest?.body)) as {
        messages: Array<{ role: string; content: string }>
      }
      expect(parsedBody.messages[0]?.content).toContain(
        'Folge einem klaren Mini-Arc: Wunsch/Anliegen -> sichtbare Aktion -> Ergebnis.',
      )
      expect(parsedBody.messages[0]?.content).toContain(
        'Vermeide Aggregationsphrasen wie "So waren ... geblieben", "insgesamt", "dann wurde".',
      )
      const payload = JSON.parse(parsedBody.messages[1]?.content ?? '{}') as {
        recentCharacterStorySoFar?: string[]
        publicConversationTimeline?: Array<Record<string, unknown>>
      }
      expect(payload.recentCharacterStorySoFar).toEqual([
        'Flora erinnerte sich an eine alte Blumenwiese.',
      ])
      expect(payload.publicConversationTimeline).toEqual([
        {
          type: 'message',
          role: 'user',
          content: 'Kannst du eine Zauberblume machen?',
          occurredAt: '2026-03-09T14:00:00.000Z',
        },
        {
          type: 'message',
          role: 'assistant',
          content: 'Ja, ich sammle schon Farben.',
          occurredAt: '2026-03-09T14:00:01.000Z',
        },
        {
          type: 'activity',
          activityType: 'conversation.image.generated',
          summary: 'Flora liess eine leuchtende Blume ueber der Wiese erbluehen.',
          occurredAt: '2026-03-09T14:00:03.000Z',
        },
      ])
      expect(result.summary).toBe('Flora und Yoko liessen gemeinsam eine Zauberblume entstehen.')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
