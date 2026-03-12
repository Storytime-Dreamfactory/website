import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  detectRuntimeIntent,
  detectRuntimeIntentContextFlags,
  detectRuntimeIntentModelDecision,
} from './intentRouter.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('detectRuntimeIntentContextFlags', () => {
  it('liest Flags aus strukturierter Modell-Ausgabe', () => {
    expect(
      detectRuntimeIntentContextFlags(
        '{ "activitiesRequested": true, "relationshipsRequested": false, "skillId": null, "reason": "context-only" }',
      ),
    ).toEqual(
      {
        activitiesRequested: true,
        relationshipsRequested: false,
      },
    )
  })

  it('faellt ohne strukturierte Ausgabe auf false/false zurueck', () => {
    expect(detectRuntimeIntentContextFlags('freie Sprache')).toEqual({
      relationshipsRequested: false,
      activitiesRequested: false,
    })
  })
})

describe('detectRuntimeIntent', () => {
  it('liest Skill-Entscheidung aus strukturierter Ausgabe', () => {
    expect(
      detectRuntimeIntent(
        '{ "activitiesRequested": true, "relationshipsRequested": false, "skillId": "remember-something", "reason": "memory-image" }',
        '',
      ),
    ).toEqual({
      skillId: 'remember-something',
      reason: 'memory-image',
    })
  })

  it('mappt legacy Skill-Aliase auf neue Skill-IDs', () => {
    expect(
      detectRuntimeIntent(
        '{ "activitiesRequested": false, "relationshipsRequested": false, "skillId": "run-quiz", "reason": "quiz-request" }',
        '',
      ),
    ).toEqual({
      skillId: 'create_scene',
      reason: 'quiz-request',
    })
  })

  it('uebernimmt simple-image-request als create_scene Grund unveraendert', () => {
    expect(
      detectRuntimeIntent(
        '{ "activitiesRequested": false, "relationshipsRequested": false, "skillId": "create_scene", "reason": "simple-image-request" }',
        '',
      ),
    ).toEqual({
      skillId: 'create_scene',
      reason: 'simple-image-request',
    })
  })

  it('liest optional selectedLearningGoalId und openTopicHint aus strukturierter Ausgabe', () => {
    expect(
      detectRuntimeIntent(
        '{ "activitiesRequested": false, "relationshipsRequested": false, "skillId": "request-context", "reason": "guided-topic", "selectedLearningGoalId": "313ab6c5-0d07-48d6-aae6-458a0218c020", "openTopicHint": "erst Fahrrad, dann Sterne" }',
        '',
      ),
    ).toEqual({
      skillId: 'request-context',
      reason: 'guided-topic',
      selectedLearningGoalId: '313ab6c5-0d07-48d6-aae6-458a0218c020',
      openTopicHint: 'erst Fahrrad, dann Sterne',
    })
  })
})

describe('detectRuntimeIntentModelDecision', () => {
  it('faellt ohne API-Key kontrolliert auf neutralen Fallback zurueck', async () => {
    const previousKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    try {
      const decision = await detectRuntimeIntentModelDecision('freie Sprache', 'freie Sprache')
      expect(decision.source).toBe('fallback')
      expect(decision.decision).toBeNull()
      expect(decision.flags).toEqual({
        relationshipsRequested: false,
        activitiesRequested: false,
      })
      expect(decision.secondaryUsed).toBe(true)
      expect(decision.primaryFailureReason).toBe('test-mode-disabled')
      expect(decision.secondaryFailureReason).toBe('test-mode-disabled')
    } finally {
      if (previousKey) process.env.OPENAI_API_KEY = previousKey
    }
  })

  it('nutzt Secondary Forced-Choice, wenn Primary skillId=null liefert', async () => {
    const previousKey = process.env.OPENAI_API_KEY
    const previousAllowNetwork = process.env.RUNTIME_INTENT_ALLOW_TEST_NETWORK
    process.env.OPENAI_API_KEY = 'test-key'
    process.env.RUNTIME_INTENT_ALLOW_TEST_NETWORK = 'true'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  activitiesRequested: true,
                  relationshipsRequested: false,
                  skillId: null,
                  reason: 'unsicher',
                }),
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  activitiesRequested: true,
                  relationshipsRequested: false,
                  skillId: 'create_scene',
                  reason: 'forced-action-choice',
                }),
              },
            },
          ],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const publicConversationHistory = [
        {
          role: 'user' as const,
          content: 'Kannst du eine Blume fuer mich machen?',
          createdAt: '2026-03-09T14:00:00.000Z',
        },
        {
          role: 'assistant' as const,
          content: 'Ja, ich mache dir eine bunte Blume.',
          eventType: 'response.audio_transcript.done',
          createdAt: '2026-03-09T14:00:02.000Z',
        },
      ]
      const decision = await detectRuntimeIntentModelDecision(
        'mach etwas',
        'assistant',
        publicConversationHistory,
      )
      expect(decision.source).toBe('llm-secondary')
      expect(decision.pass).toBe('secondary')
      expect(decision.secondaryUsed).toBe(true)
      expect(decision.primaryDecision).toBeNull()
      expect(decision.secondaryDecision).toEqual({
        skillId: 'create_scene',
        reason: 'forced-action-choice',
      })
      expect(decision.decision).toEqual({
        skillId: 'create_scene',
        reason: 'forced-action-choice',
      })
      const firstRequest = fetchMock.mock.calls[0]?.[1]
      const parsedBody = JSON.parse(String(firstRequest?.body)) as {
        messages: Array<{ role: string; content: string }>
        response_format?: {
          json_schema?: {
            schema?: {
              required?: string[]
              properties?: Record<string, unknown>
            }
          }
        }
      }
      const routerPayload = JSON.parse(parsedBody.messages[1]?.content ?? '{}') as {
        publicConversationHistory?: unknown
      }
      expect(routerPayload.publicConversationHistory).toEqual(publicConversationHistory)
      expect(parsedBody.response_format?.json_schema?.schema?.required).toEqual(
        expect.arrayContaining([
          'activitiesRequested',
          'relationshipsRequested',
          'skillId',
          'reason',
          'selectedLearningGoalId',
          'openTopicHint',
        ]),
      )
      const properties = parsedBody.response_format?.json_schema?.schema?.properties ?? {}
      expect(properties.selectedLearningGoalId).toEqual({
        anyOf: [{ type: 'string' }, { type: 'null' }],
      })
      expect(properties.openTopicHint).toEqual({
        anyOf: [{ type: 'string' }, { type: 'null' }],
      })
    } finally {
      if (previousKey) process.env.OPENAI_API_KEY = previousKey
      else delete process.env.OPENAI_API_KEY
      if (previousAllowNetwork) process.env.RUNTIME_INTENT_ALLOW_TEST_NETWORK = previousAllowNetwork
      else delete process.env.RUNTIME_INTENT_ALLOW_TEST_NETWORK
    }
  })
})
