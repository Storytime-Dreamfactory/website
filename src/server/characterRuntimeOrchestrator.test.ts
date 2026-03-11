import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createActivityMock: vi.fn(),
  listActivitiesMock: vi.fn(),
  runConversationQuizSkillMock: vi.fn(),
  recallConversationImageMock: vi.fn(),
  maybeGenerateSceneImageFromAssistantMessageMock: vi.fn(),
  noteExplicitImageRequestFromUserMessageMock: vi.fn(),
  clearExplicitImageRequestForConversationMock: vi.fn(),
  appendConversationMessageMock: vi.fn(),
  getConversationDetailsMock: vi.fn(),
  listRelationshipsForCharacterMock: vi.fn(),
  loadCharacterRuntimeProfileMock: vi.fn(),
  loadCharacterRuntimeProfilesMock: vi.fn(),
  loadLearningGoalRuntimeProfilesMock: vi.fn(),
  generateConversationHeroToolApiMock: vi.fn(),
}))

vi.mock('./activityStore.ts', () => ({
  createActivity: mocks.createActivityMock,
  listActivities: mocks.listActivitiesMock,
}))

vi.mock('./conversationQuizToolService.ts', () => ({
  runConversationQuizSkill: mocks.runConversationQuizSkillMock,
}))

vi.mock('./conversationImageMemoryToolService.ts', () => ({
  recallConversationImage: mocks.recallConversationImageMock,
}))

vi.mock('./conversationSceneImageService.ts', () => ({
  maybeGenerateSceneImageFromAssistantMessage: mocks.maybeGenerateSceneImageFromAssistantMessageMock,
  noteExplicitImageRequestFromUserMessage: mocks.noteExplicitImageRequestFromUserMessageMock,
  clearExplicitImageRequestForConversation: mocks.clearExplicitImageRequestForConversationMock,
}))

vi.mock('./conversationStore.ts', () => ({
  appendConversationMessage: mocks.appendConversationMessageMock,
  getConversationDetails: mocks.getConversationDetailsMock,
}))

vi.mock('./relationshipStore.ts', () => ({
  listRelationshipsForCharacter: mocks.listRelationshipsForCharacterMock,
}))

vi.mock('./runtimeContentStore.ts', () => ({
  loadCharacterRuntimeProfile: mocks.loadCharacterRuntimeProfileMock,
  loadCharacterRuntimeProfiles: mocks.loadCharacterRuntimeProfilesMock,
  loadLearningGoalRuntimeProfiles: mocks.loadLearningGoalRuntimeProfilesMock,
}))

vi.mock('./runtime/tools/toolApiService.ts', () => ({
  generateConversationHeroToolApi: mocks.generateConversationHeroToolApiMock,
}))

import { orchestrateCharacterRuntimeTurn } from './characterRuntimeOrchestrator.ts'

describe('orchestrateCharacterRuntimeTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createActivityMock.mockResolvedValue({})
    mocks.listActivitiesMock.mockResolvedValue([])
    mocks.runConversationQuizSkillMock.mockResolvedValue(null)
    mocks.recallConversationImageMock.mockResolvedValue(null)
    mocks.maybeGenerateSceneImageFromAssistantMessageMock.mockResolvedValue(undefined)
    mocks.noteExplicitImageRequestFromUserMessageMock.mockReturnValue(undefined)
    mocks.clearExplicitImageRequestForConversationMock.mockReturnValue(undefined)
    mocks.appendConversationMessageMock.mockResolvedValue(undefined)
    mocks.listRelationshipsForCharacterMock.mockResolvedValue([])
    mocks.loadCharacterRuntimeProfileMock.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Yoko',
      species: 'Drachenfreundin',
      shortDescription: 'Mutig und freundlich.',
      coreTraits: ['warmherzig'],
      suitableLearningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
    })
    mocks.loadCharacterRuntimeProfilesMock.mockResolvedValue([])
    mocks.loadLearningGoalRuntimeProfilesMock.mockResolvedValue([
      { id: '313ab6c5-0d07-48d6-aae6-458a0218c020', name: 'Kindness' },
    ])
    mocks.generateConversationHeroToolApiMock.mockResolvedValue({
      requestId: 'req-1',
      imageUrl: '/content/conversations/conv-1/generated.jpg',
      heroImageUrl: '/content/conversations/conv-1/generated.jpg',
      summary: 'Yoko zeigt ein neues Bild',
      model: 'flux-2-flex',
      width: 1536,
      height: 1152,
      seed: 123,
    })
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [
        {
          role: 'user',
          content: 'Kannst du mir ein Bild dazu zeigen?',
        },
      ],
    })
  })

  it('merkt sich beim User-Turn nur explizite Neu-Bildwuensche', async () => {
    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'user',
      content: 'Bitte generiere jetzt ein neues Bild fuer morgen mit einem Drachen im Wald.',
    })

    expect(mocks.noteExplicitImageRequestFromUserMessageMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      userText: 'Bitte generiere jetzt ein neues Bild fuer morgen mit einem Drachen im Wald.',
    })
    expect(mocks.getConversationDetailsMock).toHaveBeenCalledWith('conv-1')
  })

  it('delegiert allgemeine Bildwuensche an den Scene-Service zur internen Pruefung', async () => {
    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'user',
      content: 'Zeig mir bitte ein Bild vom Wald.',
    })

    expect(mocks.noteExplicitImageRequestFromUserMessageMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      userText: 'Zeig mir bitte ein Bild vom Wald.',
    })
  })

  it('routet visuelle Assistant-Antworten in create_scene und startet Bildgenerierung', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [
        {
          role: 'user',
          content: '{ "skillId": "visual-expression", "reason": "visual-request" }',
        },
      ],
    })

    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Ich zeige dir jetzt: einen kleinen Drachen zwischen bunten Baeumen.',
      eventType: 'response.audio_transcript.done',
    })

    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'runtime.skill.routed',
        characterId: '00000000-0000-4000-8000-000000000001',
        learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        metadata: expect.objectContaining({
          skillId: 'create_scene',
          reason: 'visual-request',
          activeLearningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        }),
      }),
    )
    expect(mocks.generateConversationHeroToolApiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
      }),
    )
    expect(mocks.runConversationQuizSkillMock).not.toHaveBeenCalled()
  })

  it('schneidet assistantText im runtime decision trace nicht kuenstlich auf 240 Zeichen', async () => {
    const longAssistantText =
      'Ich zeige dir jetzt: einen langen Szenentext, der frueher abgeschnitten wurde, obwohl das Modell normal geantwortet hat. ' +
      'Wir laufen gemeinsam ueber den funkelnden Platz, drehen den Stab ueber dem Kopf und lachen dabei weiter.'
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [
        {
          role: 'user',
          content: 'Kannst du deinen Stab ueber den Kopf heben?',
        },
      ],
    })

    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'assistant',
      content: longAssistantText,
      eventType: 'response.audio_transcript.done',
    })

    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'trace.runtime.decision.response',
        metadata: expect.objectContaining({
          input: expect.objectContaining({
            assistantText: longAssistantText,
            lastUserText: 'Kannst du deinen Stab ueber den Kopf heben?',
          }),
        }),
      }),
    )
  })

  it('gibt dem Routing-Trace nur die oeffentliche Conversation-Historie mit', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [
        {
          messageId: 1,
          conversationId: 'conv-1',
          role: 'user',
          content: 'Kannst du eine Zauberblume malen?',
          createdAt: '2026-03-09T14:00:00.000Z',
        },
        {
          messageId: 2,
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Ja, ich sammle schon Farben.',
          eventType: 'response.audio_transcript.done',
          createdAt: '2026-03-09T14:00:05.000Z',
        },
        {
          messageId: 3,
          conversationId: 'conv-1',
          role: 'system',
          content: 'tool output',
          eventType: 'tool.image.generated',
          createdAt: '2026-03-09T14:00:10.000Z',
        },
        {
          messageId: 4,
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'internal fallback',
          eventType: 'runtime.scene_flow.unavailable',
          createdAt: '2026-03-09T14:00:11.000Z',
        },
        {
          messageId: 5,
          conversationId: 'conv-1',
          role: 'user',
          content: 'How is it going?',
          createdAt: '2026-03-09T14:00:12.000Z',
        },
      ],
    })

    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Ich zeige dir jetzt eine leuchtende Blume.',
      eventType: 'response.audio_transcript.done',
    })

    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'trace.runtime.decision.response',
        metadata: expect.objectContaining({
          input: expect.objectContaining({
            lastUserText: 'How is it going?',
            publicConversationHistory: [
              {
                role: 'user',
                content: 'Kannst du eine Zauberblume malen?',
                eventType: undefined,
                createdAt: '2026-03-09T14:00:00.000Z',
              },
              {
                role: 'assistant',
                content: 'Ja, ich sammle schon Farben.',
                eventType: 'response.audio_transcript.done',
                createdAt: '2026-03-09T14:00:05.000Z',
              },
              {
                role: 'user',
                content: 'How is it going?',
                eventType: undefined,
                createdAt: '2026-03-09T14:00:12.000Z',
              },
            ],
          }),
        }),
      }),
    )
  })

  it('liest Activity- und Relationship-Kontext und startet bei Quiz-Anfrage den Quiz-Skill', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [
        {
          role: 'user',
          content:
            '{ "skillId": "run-quiz", "reason": "quiz-request", "relationshipsRequested": true, "activitiesRequested": true }',
        },
      ],
    })
    mocks.listRelationshipsForCharacterMock.mockResolvedValue([
      {
        relationshipId: 'r-1',
        sourceCharacterId: '00000000-0000-4000-8000-000000000001',
        targetCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
        relationshipType: 'freundin',
        relationshipTypeReadable: 'Freundin',
        relationship: 'Freundin',
        description: '',
        metadata: {},
        otherRelatedObjects: [],
        direction: 'outgoing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    mocks.listActivitiesMock.mockResolvedValue([{ activityId: 'a-1' }])
    mocks.loadCharacterRuntimeProfilesMock.mockResolvedValue([
      {
        id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
        name: 'Nola',
        species: 'Otter',
        shortDescription: 'Hilfsbereit',
        coreTraits: ['neugierig', 'freundlich'],
        suitableLearningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
      },
    ])

    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Na klar, ich habe eine kleine Frage fuer dich.',
      eventType: 'response.audio_transcript.done',
    })

    expect(mocks.listRelationshipsForCharacterMock).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001')
    expect(mocks.listActivitiesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        characterId: '00000000-0000-4000-8000-000000000001',
        limit: 12,
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'tool.relationships.read',
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'tool.activities.read',
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'tool.related_objects.read',
      }),
    )
    expect(mocks.appendConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        eventType: 'tool.relationships.context.loaded',
      }),
    )
    expect(mocks.runConversationQuizSkillMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      source: 'runtime',
      userText:
        '{ "skillId": "run-quiz", "reason": "quiz-request", "relationshipsRequested": true, "activitiesRequested": true }',
      assistantText: 'Na klar, ich habe eine kleine Frage fuer dich.',
    })
  })

  it('reicht aufgeloeste Related Objects in den create_scene-Flow weiter', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY
    const originalAllowTestNetwork = process.env.RUNTIME_INTENT_ALLOW_TEST_NETWORK
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.RUNTIME_INTENT_ALLOW_TEST_NETWORK = 'true'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const urlString =
          typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
        if (urlString.includes('api.openai.com')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      skillId: 'create_scene',
                      reason: 'visual-request',
                      activitiesRequested: false,
                      relationshipsRequested: true,
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        }
        return new Response('{}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [
        {
          role: 'user',
          content: 'Zeig mir mal, wie der Charakter, der Angst vor dir hat, vor deinem Haus steht.',
        },
      ],
    })
    mocks.listRelationshipsForCharacterMock.mockResolvedValue([
      {
        relationshipId: 'r-2',
        sourceCharacterId: '555305a8-e7d2-4d1d-8dbd-3d1194f6972a',
        targetCharacterId: '00000000-0000-4000-8000-000000000001',
        relationshipType: 'fuerchtet_sich_vor',
        relationshipTypeReadable: 'Hat Angst vor',
        relationship: 'Hat Angst vor',
        description: 'Lorelei fuerchtet Agatha.',
        metadata: {},
        otherRelatedObjects: [],
        direction: 'incoming',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ])
    mocks.loadCharacterRuntimeProfilesMock.mockResolvedValue([
      {
        id: '555305a8-e7d2-4d1d-8dbd-3d1194f6972a',
        name: 'Lorelei',
        species: 'Mensch',
        shortDescription: 'Anmutig und vorsichtig.',
        coreTraits: ['vorsichtig'],
        suitableLearningGoalIds: [],
      },
    ])

    try {
      await orchestrateCharacterRuntimeTurn({
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'Ich zeige dir jetzt: Lorelei steht vor meinem Haus.',
        eventType: 'response.audio_transcript.done',
      })
    } finally {
      vi.unstubAllGlobals()
      if (originalApiKey == null) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = originalApiKey
      }
      if (originalAllowTestNetwork == null) {
        delete process.env.RUNTIME_INTENT_ALLOW_TEST_NETWORK
      } else {
        process.env.RUNTIME_INTENT_ALLOW_TEST_NETWORK = originalAllowTestNetwork
      }
    }

    expect(mocks.generateConversationHeroToolApiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        relatedCharacterIds: ['555305a8-e7d2-4d1d-8dbd-3d1194f6972a'],
        relatedCharacterNames: ['Lorelei'],
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'conversation.scene.directed',
        metadata: expect.objectContaining({
          groundedSceneCharacters: expect.arrayContaining([
            expect.objectContaining({
              displayName: 'Lorelei',
              source: 'relationship-name-match',
            }),
          ]),
        }),
      }),
    )
  })

  it('laedt bei Erinnerungsfrage ein frueheres Bild statt Neu-Generierung', async () => {
    const memoryDecision = JSON.stringify({
      skillId: 'remember-something',
      reason: 'memory-image-request',
      activitiesRequested: true,
      relationshipsRequested: false,
    })
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [
        {
          role: 'user',
          content: memoryDecision,
        },
      ],
    })

    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Ja, ich erinnere mich an unseren letzten Moment.',
      eventType: 'response.audio_transcript.done',
    })

    expect(mocks.recallConversationImageMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      queryText: memoryDecision,
      source: 'runtime',
    })
    expect(mocks.maybeGenerateSceneImageFromAssistantMessageMock).not.toHaveBeenCalled()
  })

  it('erkennt "Bild aus einer frueheren Conversation" bereits im User-Turn', async () => {
    const userText = JSON.stringify({
      skillId: 'remember-something',
      reason: 'memory-image-request',
      activitiesRequested: true,
      relationshipsRequested: false,
    })
    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'user',
      content: userText,
      eventType: 'chat.turn',
    })

    expect(mocks.noteExplicitImageRequestFromUserMessageMock).not.toHaveBeenCalled()
    expect(mocks.recallConversationImageMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      queryText: userText,
      source: 'runtime',
    })
  })

  it('erkennt Personen-Erinnerungsfragen und triggert Recall bereits im User-Turn', async () => {
    const userText = JSON.stringify({
      skillId: 'remember-something',
      reason: 'memory-image-request',
      activitiesRequested: true,
      relationshipsRequested: false,
    })
    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'user',
      content: userText,
      eventType: 'chat.turn',
    })

    expect(mocks.noteExplicitImageRequestFromUserMessageMock).not.toHaveBeenCalled()
    expect(mocks.recallConversationImageMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      queryText: userText,
      source: 'runtime',
    })
  })

  it('wendet bei fehlender Entscheidung einen Graceful-Fail ohne Skill-Ausfuehrung an', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [
        {
          role: 'user',
          content: 'Bitte hilf mir.',
        },
      ],
    })

    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Okay, ich bin da.',
      eventType: 'response.audio_transcript.done',
    })

    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'trace.runtime.decision.response',
        metadata: expect.objectContaining({
          output: expect.objectContaining({
            skillId: null,
            gracefulFailureApplied: true,
            decisionFailureReason: expect.any(String),
          }),
        }),
      }),
    )
    expect(mocks.recallConversationImageMock).not.toHaveBeenCalled()
    expect(mocks.appendConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        role: 'assistant',
        eventType: 'runtime.intent.unavailable',
        content:
          'Ich bin aktuell leider sehr muede und kann nicht helfen. Probiere es ein bisschen spaeter noch einmal.',
      }),
    )
  })

  it('waehlt bei Action-Request stabil create_scene', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            skillId: 'create_scene',
            reason: 'action-request',
            activitiesRequested: true,
            relationshipsRequested: false,
          }),
        },
      ],
    })

    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Ich hebe den Stab langsam an.',
      eventType: 'response.audio_transcript.done',
    })

    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'trace.runtime.decision.response',
        metadata: expect.objectContaining({
          output: expect.objectContaining({
            skillId: 'create_scene',
            gracefulFailureApplied: false,
            secondaryUsed: expect.any(Boolean),
          }),
        }),
      }),
    )
    expect(mocks.generateConversationHeroToolApiMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
      }),
    )
  })
})
