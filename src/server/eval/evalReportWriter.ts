import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { SelfEvaluationArtifacts } from './selfEvaluationArtifacts.ts'
import type { SelfEvaluationResult } from './selfEvaluationJudge.ts'

type WriteEvalReportInput = {
  outputDirectory: string
  characterId: string
  scenarioId: string
  conversationId: string
  runIndex: number
  judgeModel: string
  artifacts: SelfEvaluationArtifacts
  evaluation: SelfEvaluationResult
}

const toFilenamePart = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
  return normalized.length > 0 ? normalized : 'unknown'
}

const pad = (value: number): string => String(value).padStart(2, '0')

const buildTimestamp = (date: Date): string => {
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    'T',
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
    'Z',
  ].join('')
}

const toList = (items: string[]): string => {
  if (items.length === 0) return '- (keine)'
  return items.map((item) => `- ${item}`).join('\n')
}

const toRubricLines = (input: SelfEvaluationResult): string => {
  const dimensions = [
    ['leadershipQuality', input.rubric.leadershipQuality],
    ['learningGoalAlignment', input.rubric.learningGoalAlignment],
    ['storyArcQuality', input.rubric.storyArcQuality],
    ['topicThreadHandling', input.rubric.topicThreadHandling],
  ] as const
  return dimensions
    .map(
      ([label, dimension]) =>
        `- ${label}: ${dimension.score}/10\n  diagnosis: ${dimension.diagnosis}`,
    )
    .join('\n')
}

export const writeEvalReport = async (input: WriteEvalReportInput): Promise<string> => {
  await mkdir(input.outputDirectory, { recursive: true })
  const timestamp = buildTimestamp(new Date())
  const filename = [
    timestamp,
    toFilenamePart(input.characterId),
    toFilenamePart(input.scenarioId),
    `run${input.runIndex}`,
  ].join('__')
  const outputPath = path.resolve(input.outputDirectory, `${filename}.txt`)

  const issueLines =
    input.evaluation.issues.length === 0
      ? '- (keine)'
      : input.evaluation.issues
          .map(
            (issue) =>
              `- [${issue.severity}] ${issue.title}\n  details: ${issue.details}\n  recommendation: ${issue.recommendation}`,
          )
          .join('\n')
  const taskLines =
    input.evaluation.tasks.length === 0
      ? '- (keine)'
      : input.evaluation.tasks
          .map((task, index) => `${index + 1}. [${task.priority}] ${task.title}\n   action: ${task.action}`)
          .join('\n')

  const content = [
    '# Storytime Self-Evaluation Report',
    '',
    '## Run-Informationen',
    `- characterId: ${input.characterId}`,
    `- scenario: ${input.scenarioId}`,
    `- testedScenarios: ${input.artifacts.scenarioIds.join(', ')}`,
    `- runIndex: ${input.runIndex}`,
    `- conversationId: ${input.conversationId}`,
    `- judgeModel: ${input.judgeModel}`,
    `- executionMode: ${input.artifacts.executionMode}`,
    `- assistantGenerationSource: ${input.artifacts.assistantGenerationSource}`,
    `- voicePromptPath: ${input.artifacts.voicePromptPath || '(unknown)'}`,
    `- voicePromptLength: ${input.artifacts.voicePromptLength}`,
    '',
    '## Gesamtbeurteilung',
    `- score: ${input.evaluation.score}/10`,
    `- assessment: ${input.evaluation.overallAssessment}`,
    '',
    '## Rubric-Details',
    toRubricLines(input.evaluation),
    '',
    '## Staerken',
    toList(input.evaluation.strengths),
    '',
    '## Probleme',
    issueLines,
    '',
    '## Verbesserungsaufgaben (one-by-one)',
    taskLines,
    '',
    '## Pipeline-Optimierungsvorschlag',
    taskLines,
    '',
    '## Prompt- und Tool-Kontext (zum Eval-Zeitpunkt)',
    input.artifacts.runtimeContextText,
    '',
    '## Eval-Fokus-Kontext',
    input.artifacts.evaluationFocusText,
    '',
    '## Conversation Total History',
    input.artifacts.conversationHistoryText,
    '',
    '## Public Activities',
    input.artifacts.publicActivitiesText,
    '',
    '## Bildreferenzen',
    input.artifacts.imageEvidenceText,
    '',
  ].join('\n')

  await writeFile(outputPath, content, 'utf8')
  return outputPath
}
