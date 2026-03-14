import { describe, expect, it } from 'vitest'
import { buildSelfEvaluationJudgePayload } from './selfEvaluationJudge.ts'
import type { SelfEvaluationArtifacts } from './selfEvaluationArtifacts.ts'

describe('buildSelfEvaluationJudgePayload', () => {
  it('bildet alle relevanten Eval-Felder fuer den Judge ab', () => {
    const artifacts: SelfEvaluationArtifacts = {
      scenarioIds: ['memory', 'image'],
      conversationId: 'conv-123',
      characterId: 'yoko',
      executionMode: 'cli',
      assistantGenerationSource: 'shared-voice-service',
      voicePromptPath: '/tmp/character-voice-agent.md',
      voicePromptLength: 111,
      conversationHistoryText: '1. user: hi',
      publicActivitiesText: '1. conversation.image.generated: ...',
      imageEvidenceText: '1. activity/conversation.image.generated: /img.jpg',
      runtimeContextText: 'Aktuelle Prompt-Dateien: ...',
      evaluationFocusText: 'counterpartName: Yoko',
      images: [],
      publicActivities: [],
    }

    const payload = buildSelfEvaluationJudgePayload(artifacts)
    expect(payload).toEqual({
      scenarioIds: ['memory', 'image'],
      conversationId: 'conv-123',
      characterId: 'yoko',
      executionMode: 'cli',
      assistantGenerationSource: 'shared-voice-service',
      voicePromptPath: '/tmp/character-voice-agent.md',
      voicePromptLength: 111,
      conversationHistory: '1. user: hi',
      publicActivities: '1. conversation.image.generated: ...',
      images: '1. activity/conversation.image.generated: /img.jpg',
      runtimeContext: 'Aktuelle Prompt-Dateien: ...',
      evaluationFocus: 'counterpartName: Yoko',
    })
  })
})
