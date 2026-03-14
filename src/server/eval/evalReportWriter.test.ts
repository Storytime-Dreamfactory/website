import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeEvalReport } from './evalReportWriter.ts'
import type { SelfEvaluationArtifacts } from './selfEvaluationArtifacts.ts'
import type { SelfEvaluationResult } from './selfEvaluationJudge.ts'

describe('writeEvalReport', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
    tempDirs.length = 0
  })

  it('schreibt einen strukturierten Eval-Report als Textdatei', async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'storytime-eval-'))
    tempDirs.push(outputDirectory)

    const artifacts: SelfEvaluationArtifacts = {
      scenarioIds: ['memory', 'image', 'chat', 'mixed'],
      conversationId: 'conv-1',
      characterId: 'yoko',
      executionMode: 'cli',
      assistantGenerationSource: 'shared-voice-service',
      voicePromptPath: '/tmp/character-voice-agent.md',
      voicePromptLength: 111,
      conversationHistoryText: '1. user: hallo',
      publicActivitiesText: '1. conversation.image.generated: Ein Bild wurde erzeugt',
      imageEvidenceText: '1. activity/conversation.image.generated: /img.jpg',
      runtimeContextText: 'Aktuelle Prompt-Dateien:\n- intent-router: ...',
      evaluationFocusText: 'counterpartName: Yoko',
      images: [],
      publicActivities: [],
    }
    const evaluation: SelfEvaluationResult = {
      score: 8,
      rubric: {
        leadershipQuality: { score: 8, diagnosis: 'Fuehrung klar erkennbar.' },
        learningGoalAlignment: { score: 6, diagnosis: 'Lernziel ist angedeutet.' },
        storyArcQuality: { score: 7, diagnosis: 'Spannung kindgerecht.' },
        topicThreadHandling: { score: 5, diagnosis: 'Threading teils lueckig.' },
      },
      overallAssessment: 'Insgesamt gut, mit kleineren Verbesserungen.',
      strengths: ['Freundlicher Ton'],
      issues: [
        {
          severity: 'medium',
          title: 'Memory zu spaet',
          details: 'Recall kam erst im Folgeturn.',
          recommendation: 'Recall frueher triggern.',
        },
      ],
      tasks: [
        {
          priority: 'high',
          title: 'Memory-Prompt schaerfen',
          action: 'Im Router den Recall-Hinweis staerker gewichten.',
        },
      ],
    }

    const reportPath = await writeEvalReport({
      outputDirectory,
      characterId: 'yoko',
      scenarioId: 'image',
      conversationId: 'conv-1',
      runIndex: 1,
      judgeModel: 'gpt-5.4',
      artifacts,
      evaluation,
    })

    const report = await readFile(reportPath, 'utf8')
    expect(report).toContain('# Storytime Self-Evaluation Report')
    expect(report).toContain('## Conversation Total History')
    expect(report).toContain('## Public Activities')
    expect(report).toContain('## Bildreferenzen')
    expect(report).toContain('## Rubric-Details')
    expect(report).toContain('leadershipQuality: 8/10')
    expect(report).toContain('## Eval-Fokus-Kontext')
    expect(report).toContain('## Prompt- und Tool-Kontext (zum Eval-Zeitpunkt)')
    expect(report).toContain('assistantGenerationSource: shared-voice-service')
    expect(report).toContain('Memory-Prompt schaerfen')
  })
})
