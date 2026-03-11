import { describe, expect, it } from 'vitest'
import {
  buildPublicConversationMessageSummary,
  formatCharacterDisplayName,
  isPublicConversationMessageRole,
  isTechnicalConversationEventType,
  resolveCounterpartName,
  toPublicConversationHistory,
} from './conversationActivityHelpers.ts'

describe('conversationActivityHelpers', () => {
  it('markiert nur user- und assistant-messages als public', () => {
    expect(isPublicConversationMessageRole('user')).toBe(true)
    expect(isPublicConversationMessageRole('assistant')).toBe(true)
    expect(isPublicConversationMessageRole('system')).toBe(false)
  })

  it('formatiert Character-IDs lesbar fuer die Activity-Anzeige', () => {
    expect(formatCharacterDisplayName('flora-blumenfreude')).toBe('Flora Blumenfreude')
    expect(formatCharacterDisplayName('nola')).toBe('Nola')
  })

  it('baut oeffentliche Message-Summaries mit Sprechername', () => {
    expect(
      buildPublicConversationMessageSummary({
        role: 'assistant',
        content: 'Magst du mit mir spielen?',
        characterId: 'flora-blumenfreude',
      }),
    ).toBe('Flora Blumenfreude: Magst du mit mir spielen?')

    expect(
      buildPublicConversationMessageSummary({
        role: 'user',
        content: 'Ja, gern!',
        conversationMetadata: { counterpartName: 'Mila' },
      }),
    ).toBe('Mila: Ja, gern!')
  })

  it('faellt fuer den User-Namen auf den Default zurueck', () => {
    expect(resolveCounterpartName(undefined)).toBe('Yoko')
  })

  it('filtert oeffentliche Conversation-Historie ohne technische Events', () => {
    expect(
      toPublicConversationHistory([
        {
          messageId: 1,
          conversationId: 'conv-1',
          role: 'user',
          content: '  Hallo  ',
          createdAt: '2026-03-09T10:00:00.000Z',
        },
        {
          messageId: 2,
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'Ich bin da.',
          eventType: 'response.audio_transcript.done',
          createdAt: '2026-03-09T10:00:01.000Z',
        },
        {
          messageId: 3,
          conversationId: 'conv-1',
          role: 'assistant',
          content: 'hidden',
          eventType: 'runtime.scene_flow.unavailable',
          createdAt: '2026-03-09T10:00:02.000Z',
        },
        {
          messageId: 4,
          conversationId: 'conv-1',
          role: 'system',
          content: 'tool',
          createdAt: '2026-03-09T10:00:03.000Z',
        },
      ]),
    ).toEqual([
      {
        role: 'user',
        content: 'Hallo',
        eventType: undefined,
        createdAt: '2026-03-09T10:00:00.000Z',
      },
      {
        role: 'assistant',
        content: 'Ich bin da.',
        eventType: 'response.audio_transcript.done',
        createdAt: '2026-03-09T10:00:01.000Z',
      },
    ])
    expect(isTechnicalConversationEventType('trace.runtime.decision.response')).toBe(true)
    expect(isTechnicalConversationEventType('response.audio_transcript.done')).toBe(false)
  })
})
