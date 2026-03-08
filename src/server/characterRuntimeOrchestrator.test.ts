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
      id: 'yoko',
      name: 'Yoko',
      species: 'Drachenfreundin',
      shortDescription: 'Mutig und freundlich.',
      coreTraits: ['warmherzig'],
      suitableLearningGoalIds: ['kindness'],
    })
    mocks.loadCharacterRuntimeProfilesMock.mockResolvedValue([])
    mocks.loadLearningGoalRuntimeProfilesMock.mockResolvedValue([
      { id: 'kindness', name: 'Kindness' },
    ])
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: 'yoko',
        metadata: {
          learningGoalIds: ['kindness'],
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
    expect(mocks.getConversationDetailsMock).not.toHaveBeenCalled()
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

  it('routet visuelle Assistant-Antworten in do-something und startet Bildgenerierung', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: 'yoko',
        metadata: {
          learningGoalIds: ['kindness'],
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
        characterId: 'yoko',
        learningGoalIds: ['kindness'],
        metadata: expect.objectContaining({
          skillId: 'do-something',
          reason: 'visual-request',
          activeLearningGoalIds: ['kindness'],
        }),
      }),
    )
    expect(mocks.maybeGenerateSceneImageFromAssistantMessageMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      assistantText: 'Ich zeige dir jetzt: einen kleinen Drachen zwischen bunten Baeumen.',
      eventType: 'response.audio_transcript.done',
    })
    expect(mocks.runConversationQuizSkillMock).not.toHaveBeenCalled()
  })

  it('liest Activity- und Relationship-Kontext und startet bei Quiz-Anfrage den Quiz-Skill', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: 'yoko',
        metadata: {
          learningGoalIds: ['kindness'],
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
        sourceCharacterId: 'yoko',
        targetCharacterId: 'nola',
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
        id: 'nola',
        name: 'Nola',
        species: 'Otter',
        shortDescription: 'Hilfsbereit',
        coreTraits: ['neugierig', 'freundlich'],
        suitableLearningGoalIds: ['kindness'],
      },
    ])

    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Na klar, ich habe eine kleine Frage fuer dich.',
      eventType: 'response.audio_transcript.done',
    })

    expect(mocks.listRelationshipsForCharacterMock).toHaveBeenCalledWith('yoko')
    expect(mocks.listActivitiesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
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

  it('laedt bei Erinnerungsfrage ein frueheres Bild statt Neu-Generierung', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: 'yoko',
        metadata: {
          learningGoalIds: ['kindness'],
        },
      },
      messages: [
        {
          role: 'user',
          content: 'Kannst du dich erinnern wo wir waren und das Bild von damals zeigen?',
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
      queryText: 'Kannst du dich erinnern wo wir waren und das Bild von damals zeigen?',
      source: 'runtime',
    })
    expect(mocks.maybeGenerateSceneImageFromAssistantMessageMock).not.toHaveBeenCalled()
  })

  it('erkennt "Bild aus einer frueheren Conversation" bereits im User-Turn', async () => {
    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'user',
      content: 'Kannst du mir ein Bild aus einer frueheren Conversation zeigen?',
      eventType: 'chat.turn',
    })

    expect(mocks.noteExplicitImageRequestFromUserMessageMock).not.toHaveBeenCalled()
    expect(mocks.recallConversationImageMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      queryText: 'Kannst du mir ein Bild aus einer frueheren Conversation zeigen?',
      source: 'runtime',
    })
  })

  it('erkennt Personen-Erinnerungsfragen und triggert Recall bereits im User-Turn', async () => {
    await orchestrateCharacterRuntimeTurn({
      conversationId: 'conv-1',
      role: 'user',
      content: 'Hast du etwas mit Juna erlebt?',
      eventType: 'chat.turn',
    })

    expect(mocks.noteExplicitImageRequestFromUserMessageMock).not.toHaveBeenCalled()
    expect(mocks.recallConversationImageMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      queryText: 'Hast du etwas mit Juna erlebt?',
      source: 'runtime',
    })
  })

  it('wendet bei fehlender Entscheidung einen stabilen degraded Fallback an', async () => {
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-1',
        characterId: 'yoko',
        metadata: {
          learningGoalIds: ['kindness'],
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
            degradedFallbackApplied: true,
            preDegradedSkillId: null,
            skillId: 'remember-something',
          }),
        }),
      }),
    )
    expect(mocks.recallConversationImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        source: 'runtime',
      }),
    )
  })
})
