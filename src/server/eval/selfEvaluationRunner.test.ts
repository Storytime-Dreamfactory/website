import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateCharacterVoiceAssistantTextMock: vi.fn(),
}))

vi.mock('../characterVoiceResponseService.ts', () => ({
  generateCharacterVoiceAssistantText: mocks.generateCharacterVoiceAssistantTextMock,
}))

import { runSelfEvaluation } from './selfEvaluationRunner.ts'
import type { ConversationInspection } from '../debugConversationReadService.ts'

const inspectionFixture: ConversationInspection = {
  conversation: {
    conversationId: 'conv-1',
    characterId: 'yoko',
    startedAt: '2026-01-01T00:00:00.000Z',
    metadata: {},
  },
  messages: [
    {
      messageId: 1,
      conversationId: 'conv-1',
      role: 'user',
      content: 'Hallo',
      createdAt: '2026-01-01T00:00:00.000Z',
      eventType: 'chat.turn',
      metadata: {},
    },
  ],
  activities: [],
}

describe('runSelfEvaluation', () => {
  it('durchlaeuft Szenarien und schreibt Reports', async () => {
    mocks.generateCharacterVoiceAssistantTextMock.mockResolvedValue({
      assistantText: 'Auto-generierte Antwort',
      context: {
        promptInfo: {
          promptPath: '/tmp/character-voice-agent.md',
          promptLength: 1234,
        },
      },
    })
    const start = vi.fn().mockResolvedValue({
      conversationId: 'conv-1',
    })
    const append = vi.fn().mockResolvedValue(undefined)
    const end = vi.fn().mockResolvedValue(undefined)
    const inspect = vi.fn().mockResolvedValue(inspectionFixture)
    const judge = vi.fn().mockResolvedValue({
      score: 7,
      overallAssessment: 'ok',
      strengths: [],
      issues: [],
      tasks: [],
    })
    const writeReport = vi.fn().mockResolvedValue('/tmp/report.txt')
    const log = vi.fn()

    const results = await runSelfEvaluation(
      {
        characterId: 'yoko',
        scenarioIds: ['chat'],
        runs: 1,
        outputDirectory: '/tmp/Eval',
      },
      {
        start,
        append,
        end,
        inspect,
        judge,
        writeReport,
        log,
      },
    )

    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          counterpartName: 'Yoko',
          counterpartCharacterId: 'yoko',
        }),
      }),
    )
    expect(append).toHaveBeenCalledTimes(4)
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        metadata: expect.objectContaining({
          actorType: 'character',
          actorId: 'yoko',
        }),
      }),
    )
    expect(end).toHaveBeenCalledTimes(1)
    expect(inspect).toHaveBeenCalledWith('conv-1')
    expect(judge).toHaveBeenCalledTimes(1)
    expect(writeReport).toHaveBeenCalledTimes(1)
    expect(results).toEqual([
      {
        scenarioIds: ['chat'],
        runIndex: 1,
        conversationId: 'conv-1',
        reportPath: '/tmp/report.txt',
        score: 7,
        executionMode: 'cli',
      },
    ])
  })
})
