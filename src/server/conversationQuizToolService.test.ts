import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appendConversationMessageMock: vi.fn(),
  getConversationDetailsMock: vi.fn(),
  createActivityMock: vi.fn(),
  listActivitiesMock: vi.fn(),
  loadCharacterRuntimeProfileMock: vi.fn(),
  loadLearningGoalRuntimeProfileMock: vi.fn(),
  loadLearningGoalRuntimeProfilesMock: vi.fn(),
}))

vi.mock('./conversationStore.ts', () => ({
  appendConversationMessage: mocks.appendConversationMessageMock,
  getConversationDetails: mocks.getConversationDetailsMock,
}))

vi.mock('./activityStore.ts', () => ({
  createActivity: mocks.createActivityMock,
  listActivities: mocks.listActivitiesMock,
}))

vi.mock('./runtimeContentStore.ts', () => ({
  loadCharacterRuntimeProfile: mocks.loadCharacterRuntimeProfileMock,
  loadLearningGoalRuntimeProfile: mocks.loadLearningGoalRuntimeProfileMock,
  loadLearningGoalRuntimeProfiles: mocks.loadLearningGoalRuntimeProfilesMock,
}))

import { runConversationQuizSkill } from './conversationQuizToolService.ts'

describe('conversationQuizToolService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appendConversationMessageMock.mockResolvedValue({})
    mocks.createActivityMock.mockResolvedValue({})
    mocks.listActivitiesMock.mockResolvedValue([])
    mocks.loadCharacterRuntimeProfileMock.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Yoko',
      suitableLearningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
    })
    mocks.loadLearningGoalRuntimeProfilesMock.mockResolvedValue([
      {
        id: '313ab6c5-0d07-48d6-aae6-458a0218c020',
        name: 'Kindness',
        topic: 'Freundlichkeit im Alltag',
        exampleQuestions: ['Frage 1', 'Frage 2'],
        practiceIdeas: ['Idee 1'],
      },
    ])
    mocks.loadLearningGoalRuntimeProfileMock.mockResolvedValue({
      id: '313ab6c5-0d07-48d6-aae6-458a0218c020',
      name: 'Kindness',
      topic: 'Freundlichkeit im Alltag',
      exampleQuestions: ['Frage 1', 'Frage 2'],
      practiceIdeas: ['Idee 1'],
    })
    mocks.getConversationDetailsMock.mockResolvedValue({
      conversation: {
        conversationId: 'conv-quiz',
        characterId: '00000000-0000-4000-8000-000000000001',
        metadata: {
          learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
        },
      },
      messages: [],
    })
  })

  it('waehlt fuer das Quiz bevorzugt eine noch nicht gestellte Lernziel-Frage', async () => {
    mocks.listActivitiesMock.mockResolvedValue([
      {
        activityId: 'quiz-1',
        metadata: {
          question: 'Frage 1',
        },
      },
    ])

    const result = await runConversationQuizSkill({
      conversationId: 'conv-quiz',
      source: 'api',
      userText: 'Mach ein Quiz',
      assistantText: 'Los geht es',
    })

    expect(result).toEqual(
      expect.objectContaining({
        learningGoalId: '313ab6c5-0d07-48d6-aae6-458a0218c020',
        question: 'Frage 2',
        questionIndex: 2,
        totalQuestions: 2,
      }),
    )
    expect(mocks.appendConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-quiz',
        eventType: 'skill.quiz.prompt.generated',
        metadata: expect.objectContaining({
          learningGoalId: '313ab6c5-0d07-48d6-aae6-458a0218c020',
          question: 'Frage 2',
          questionIndex: 2,
        }),
      }),
    )
    expect(mocks.createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'tool.activities.read',
        learningGoalIds: ['313ab6c5-0d07-48d6-aae6-458a0218c020'],
      }),
    )
  })

})
