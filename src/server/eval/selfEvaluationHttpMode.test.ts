import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateCharacterVoiceAssistantTextMock: vi.fn(),
  runSelfEvaluationJudgeMock: vi.fn(),
  writeEvalReportMock: vi.fn(),
}))

vi.mock('../characterVoiceResponseService.ts', () => ({
  generateCharacterVoiceAssistantText: mocks.generateCharacterVoiceAssistantTextMock,
}))

vi.mock('./selfEvaluationJudge.ts', () => ({
  SELF_EVAL_MODEL: 'gpt-5.4',
  runSelfEvaluationJudge: mocks.runSelfEvaluationJudgeMock,
}))

vi.mock('./evalReportWriter.ts', () => ({
  writeEvalReport: mocks.writeEvalReportMock,
}))

import { runSelfEvaluation } from './selfEvaluationRunner.ts'

describe('runSelfEvaluation http mode', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('laeuft im HTTP-Mode ueber Conversations-Endpunkte', async () => {
    mocks.generateCharacterVoiceAssistantTextMock.mockResolvedValue({
      assistantText: 'Hallo Yoko, ich antworte dir jetzt direkt.',
      context: {
        promptInfo: {
          promptPath: '/tmp/character-voice-agent.md',
          promptLength: 2345,
        },
      },
    })
    mocks.runSelfEvaluationJudgeMock.mockResolvedValue({
      score: 9,
      overallAssessment: 'gut',
      strengths: [],
      issues: [],
      tasks: [],
    })
    mocks.writeEvalReportMock.mockResolvedValue('/tmp/eval-http.txt')

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/conversations/start')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ conversation: { conversationId: 'conv-http-1' } }),
        }
      }
      if (url.includes('/api/conversations/message')) {
        return { ok: true, text: async () => JSON.stringify({ message: { messageId: 1 } }) }
      }
      if (url.includes('/api/conversations/end')) {
        return { ok: true, text: async () => JSON.stringify({ conversation: { conversationId: 'conv-http-1' } }) }
      }
      if (url.includes('/api/conversations/inspect')) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              conversation: {
                conversationId: 'conv-http-1',
                characterId: 'agatha-knusperhexe',
                startedAt: '2026-01-01T00:00:00.000Z',
                metadata: {},
              },
              messages: [
                {
                  messageId: 1,
                  conversationId: 'conv-http-1',
                  role: 'user',
                  content: 'Hallo',
                  createdAt: '2026-01-01T00:00:00.000Z',
                  eventType: 'chat.turn',
                  metadata: {},
                },
              ],
              activities: [],
            }),
        }
      }
      return { ok: false, status: 404, text: async () => 'not found' }
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await runSelfEvaluation({
      characterId: 'agatha-knusperhexe',
      scenarioIds: ['chat'],
      runs: 1,
      outputDirectory: '/tmp/Eval',
      maxTurns: 1,
      executionMode: 'http',
      baseUrl: 'http://localhost:5173',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/api/conversations/start',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/conversations/inspect?conversationId=conv-http-1'),
    )
    expect(result[0]).toEqual(
      expect.objectContaining({
        executionMode: 'http',
        conversationId: 'conv-http-1',
        score: 9,
      }),
    )
  })
})
