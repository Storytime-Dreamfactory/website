import { describe, expect, it } from 'vitest'
import { buildSelfEvaluationArtifacts } from './selfEvaluationArtifacts.ts'
import type { ConversationInspection } from '../debugConversationReadService.ts'

const buildInspection = (): ConversationInspection => ({
  conversation: {
    conversationId: 'conv-1',
    characterId: 'agatha-knusperhexe',
    startedAt: '2026-03-12T10:00:00.000Z',
    metadata: {
      counterpartName: 'Yoko',
      selfEvaluationScenarios: ['image', 'chat'],
    },
  },
  messages: [
    {
      messageId: 1,
      conversationId: 'conv-1',
      role: 'user',
      content: 'Kannst du mir ein Bild zeigen?',
      eventType: 'chat.turn',
      createdAt: '2026-03-12T10:00:01.000Z',
      metadata: {},
    },
    {
      messageId: 2,
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'Ich zeige dir jetzt einen Otter.',
      eventType: 'response.audio_transcript.done',
      createdAt: '2026-03-12T10:00:02.000Z',
      metadata: {},
    },
    {
      messageId: 3,
      conversationId: 'conv-1',
      role: 'system',
      content: 'technischer Tool-Eintrag',
      eventType: 'tool.image.generated',
      createdAt: '2026-03-12T10:00:03.000Z',
      metadata: {
        imageUrl: '/content/conversations/conv-1/tool-img.jpg',
        summary: 'Tool Summary',
      },
    },
  ],
  activities: [
    {
      activityId: 'act-msg',
      activityType: 'conversation.message.created',
      isPublic: true,
      learningGoalIds: [],
      conversationId: 'conv-1',
      subject: {},
      object: { role: 'assistant' },
      metadata: { summary: 'Agatha: Ich zeige dir jetzt einen Otter.' },
      occurredAt: '2026-03-12T10:00:02.000Z',
      createdAt: '2026-03-12T10:00:02.000Z',
    },
    {
      activityId: 'act-image-public',
      activityType: 'conversation.image.generated',
      isPublic: true,
      learningGoalIds: [],
      conversationId: 'conv-1',
      subject: {},
      object: {},
      metadata: {
        imageUrl: '/content/conversations/conv-1/tool-img.jpg',
        summary: 'Kanonische Story-Summary',
      },
      occurredAt: '2026-03-12T10:00:04.000Z',
      createdAt: '2026-03-12T10:00:04.000Z',
    },
    {
      activityId: 'act-image-recalled',
      activityType: 'conversation.image.recalled',
      isPublic: true,
      learningGoalIds: [],
      conversationId: 'conv-1',
      subject: {},
      object: {},
      metadata: {
        imageUrl: '/content/conversations/conv-1/other-img.jpg',
        summary: 'Altes Bild wurde erinnert',
      },
      occurredAt: '2026-03-12T10:00:05.000Z',
      createdAt: '2026-03-12T10:00:05.000Z',
    },
  ],
})

describe('buildSelfEvaluationArtifacts', () => {
  it('filtert technische Events aus der Conversation-History', () => {
    const artifacts = buildSelfEvaluationArtifacts({
      scenarioIds: ['image'],
      runtimeContextText: 'ctx',
      executionMode: 'cli',
      assistantGenerationSource: 'shared-voice-service',
      voicePromptPath: '/tmp/prompt.md',
      voicePromptLength: 100,
      inspection: buildInspection(),
    })

    expect(artifacts.conversationHistoryText).toContain('1. user [chat.turn]: Kannst du mir ein Bild zeigen?')
    expect(artifacts.conversationHistoryText).toContain(
      '2. assistant [response.audio_transcript.done]: Ich zeige dir jetzt einen Otter.',
    )
    expect(artifacts.conversationHistoryText).not.toContain('tool.image.generated')
    expect(artifacts.conversationHistoryText).not.toContain('technischer Tool-Eintrag')
  })

  it('entfernt conversation.message.created aus Public Activities fuer den Eval-Text', () => {
    const artifacts = buildSelfEvaluationArtifacts({
      scenarioIds: ['image'],
      runtimeContextText: 'ctx',
      executionMode: 'cli',
      assistantGenerationSource: 'shared-voice-service',
      voicePromptPath: '/tmp/prompt.md',
      voicePromptLength: 100,
      inspection: buildInspection(),
    })

    expect(artifacts.publicActivitiesText).toContain('conversation.image.generated')
    expect(artifacts.publicActivitiesText).not.toContain('conversation.message.created')
  })

  it('dedupliziert Bildbelege nach kanonischer Prioritaet', () => {
    const artifacts = buildSelfEvaluationArtifacts({
      scenarioIds: ['image'],
      runtimeContextText: 'ctx',
      executionMode: 'cli',
      assistantGenerationSource: 'shared-voice-service',
      voicePromptPath: '/tmp/prompt.md',
      voicePromptLength: 100,
      inspection: buildInspection(),
    })

    expect(artifacts.imageEvidenceText).toContain(
      '1. activity/conversation.image.generated: /content/conversations/conv-1/tool-img.jpg',
    )
    expect(artifacts.imageEvidenceText).toContain(
      '2. activity/conversation.image.recalled: /content/conversations/conv-1/other-img.jpg',
    )
    expect(artifacts.imageEvidenceText).not.toContain('message/tool.image.generated')
  })
})
