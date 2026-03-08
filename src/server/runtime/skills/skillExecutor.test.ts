import { beforeEach, describe, expect, it, vi } from 'vitest'
const traceMock = vi.hoisted(() => vi.fn())
const recallMock = vi.hoisted(() => vi.fn())
const generateSceneMock = vi.hoisted(() => vi.fn())
const runQuizMock = vi.hoisted(() => vi.fn())
const runCliExecuteMock = vi.hoisted(() => vi.fn())
const readActivitiesExecuteMock = vi.hoisted(() => vi.fn())
const readConversationHistoryExecuteMock = vi.hoisted(() => vi.fn())
const showImageExecuteMock = vi.hoisted(() => vi.fn())

vi.mock('../../traceActivity.ts', () => ({
  trackTraceActivitySafely: traceMock,
}))

vi.mock('../../conversationImageMemoryToolService.ts', () => ({
  recallConversationImage: recallMock,
}))

vi.mock('../../conversationSceneImageService.ts', () => ({
  maybeGenerateSceneImageFromAssistantMessage: generateSceneMock,
}))

vi.mock('../../conversationQuizToolService.ts', () => ({
  runConversationQuizSkill: runQuizMock,
}))

vi.mock('../tools/runtimeToolRegistry.ts', () => ({
  readActivitiesRuntimeTool: () => ({
    execute: readActivitiesExecuteMock,
  }),
  readConversationHistoryRuntimeTool: () => ({
    execute: readConversationHistoryExecuteMock,
  }),
  showImageRuntimeTool: () => ({
    execute: showImageExecuteMock,
  }),
  runCliTaskRuntimeTool: () => ({
    execute: runCliExecuteMock,
  }),
}))

import { executeRoutedSkill } from './skillExecutor.ts'

describe('executeRoutedSkill agent-first execution wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    traceMock.mockResolvedValue(undefined)
    recallMock.mockResolvedValue(null)
    generateSceneMock.mockResolvedValue(undefined)
    runQuizMock.mockResolvedValue(null)
    readActivitiesExecuteMock.mockResolvedValue({
      activityCount: 1,
      hasMore: false,
      nextOffset: 1,
      items: [
        {
          activityId: 'a-1',
          activityType: 'conversation.image.recalled',
          isPublic: true,
          conversationId: 'conv-1',
          occurredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          objectType: 'image',
          objectId: 'img-1',
          imageRefs: { imageId: 'img-1', imageUrl: '/content/img-1.jpg' },
          summary: 'Eiffelturm Erinnerung',
          metadata: {},
        },
      ],
    })
    readConversationHistoryExecuteMock.mockResolvedValue({
      scope: 'external',
      limit: 200,
      offset: 0,
      conversations: [
        {
          conversationId: 'conv-1',
          characterId: 'yoko',
          startedAt: new Date().toISOString(),
          messageCount: 1,
          hasMore: false,
          nextOffset: 1,
          messages: [],
          imageCandidates: [
            {
              messageId: 1,
              imageId: 'img-1',
              imageUrl: '/content/img-1.jpg',
              scenePrompt: 'Eiffelturm am Fluss',
              source: 'message-metadata',
            },
          ],
        },
      ],
    })
    showImageExecuteMock.mockResolvedValue({
      imageUrl: '/content/img-1.jpg',
      reason: 'query_match',
      scenePrompt: 'Eiffelturm am Fluss',
    })
    runCliExecuteMock.mockResolvedValue({
      ok: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 5,
      commandPreview: 'npm run runtime:smoke',
    })
  })

  it('fuehrt bei remember-something das show_image Tool aus', async () => {
    await executeRoutedSkill({
      conversationId: 'conv-1',
      decision: { skillId: 'remember-something', reason: 'memory-image-request' },
      assistantText: 'Ich schaue kurz in unsere Erinnerungen.',
      lastUserText: 'Zeig mir ein Bild aus unserer Erinnerung.',
      characterId: 'yoko',
      characterName: 'Yoko',
      toolExecutionIntent: null,
    })

    expect(readActivitiesExecuteMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        scope: 'external',
        limit: 200,
      }),
    )
    expect(readConversationHistoryExecuteMock).toHaveBeenCalled()
    expect(showImageExecuteMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        source: 'runtime',
        preferredImageUrl: '/content/img-1.jpg',
        preferredImageId: 'img-1',
      }),
    )
    expect(traceMock).toHaveBeenCalledTimes(2)
    expect(traceMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        activityType: 'trace.skill.execution.response',
        output: expect.objectContaining({
          skillId: 'remember-something',
          hasToolExecutionIntent: false,
          executedTools: expect.arrayContaining([
            'read_activities',
            'read_conversation_history',
            'show_image',
          ]),
        }),
      }),
    )
  })

  it('fuehrt visuelle Generierung, Quiz und CLI-Task bei do-something aus', async () => {
    await executeRoutedSkill({
      conversationId: 'conv-1',
      decision: { skillId: 'do-something', reason: 'quiz-request' },
      assistantText: 'Ich zeige dir jetzt eine Szene. Und hier ist eine kleine Frage.',
      lastUserText: 'Bitte Quiz starten und Runtime Smoke ausfuehren.',
      characterId: 'yoko',
      characterName: 'Yoko',
      toolExecutionIntent: {
        taskId: 'runtime_smoke',
        dryRun: false,
        reason: 'runtime-smoke-request',
      },
    })

    expect(generateSceneMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      assistantText: 'Ich zeige dir jetzt eine Szene. Und hier ist eine kleine Frage.',
      eventType: undefined,
    })
    expect(runQuizMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      userText: 'Bitte Quiz starten und Runtime Smoke ausfuehren.',
      assistantText: 'Ich zeige dir jetzt eine Szene. Und hier ist eine kleine Frage.',
      source: 'runtime',
    })
    expect(runCliExecuteMock).toHaveBeenCalled()
    expect(traceMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        output: expect.objectContaining({
          hasToolExecutionIntent: true,
          toolExecutionTaskId: 'runtime_smoke',
          executedTools: expect.arrayContaining([
            'generate_image',
            'run_quiz',
            'run_cli_task',
          ]),
        }),
      }),
    )
  })

  it('waehlt fuer Juna Lia das relevante glitzernder-stein-Bild statt latest', async () => {
    readActivitiesExecuteMock.mockResolvedValueOnce({
      activityCount: 2,
      hasMore: false,
      nextOffset: 2,
      items: [
        {
          activityId: 'a-latest',
          activityType: 'conversation.image.recalled',
          isPublic: true,
          conversationId: 'conv-juna-2',
          occurredAt: new Date('2026-03-08T10:00:00.000Z').toISOString(),
          createdAt: new Date('2026-03-08T10:00:00.000Z').toISOString(),
          objectType: 'image',
          objectId: 'img-latest',
          imageRefs: { imageId: 'img-latest', imageUrl: '/content/conversations/x/latest.jpg' },
          summary: 'Juna Lia am Fluss mit Blume',
          metadata: {},
        },
        {
          activityId: 'a-stone',
          activityType: 'conversation.image.generated',
          isPublic: true,
          conversationId: 'conv-juna-1',
          occurredAt: new Date('2026-03-07T10:00:00.000Z').toISOString(),
          createdAt: new Date('2026-03-07T10:00:00.000Z').toISOString(),
          objectType: 'image',
          objectId: 'img-glitzerstein',
          imageRefs: {
            imageId: 'img-glitzerstein',
            imageUrl: '/content/conversations/eval-juna-lia/glitzernder-stein.svg',
          },
          summary: 'Juna Lia findet einen glitzernden Stein am Ufer',
          metadata: {},
        },
      ],
    })
    readConversationHistoryExecuteMock.mockResolvedValueOnce({
      scope: 'external',
      limit: 200,
      offset: 0,
      conversations: [
        {
          conversationId: 'conv-juna-1',
          characterId: 'juna-lia',
          startedAt: new Date('2026-03-07T09:30:00.000Z').toISOString(),
          messageCount: 1,
          hasMore: false,
          nextOffset: 1,
          messages: [],
          imageCandidates: [
            {
              messageId: 3,
              imageId: 'img-glitzerstein',
              imageUrl: '/content/conversations/eval-juna-lia/glitzernder-stein.svg',
              scenePrompt: 'Juna Lia haelt einen glitzernden Stein in den Haenden',
              source: 'message-metadata',
            },
          ],
        },
      ],
    })

    await executeRoutedSkill({
      conversationId: 'conv-now',
      decision: { skillId: 'remember-something', reason: 'memory-image-request' },
      assistantText: 'Ich schaue kurz nach.',
      lastUserText: 'Findest du ein Bild mit dem glitzernden Stein?',
      characterId: 'juna-lia',
      characterName: 'Juna Lia',
      toolExecutionIntent: null,
    })

    expect(showImageExecuteMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        preferredImageId: 'img-glitzerstein',
        preferredImageUrl: '/content/conversations/eval-juna-lia/glitzernder-stein.svg',
        source: 'runtime',
      }),
    )
  })
})
