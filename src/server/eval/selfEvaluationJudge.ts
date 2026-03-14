import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getOpenAiApiKey, readServerEnv } from '../openAiConfig.ts'
import type { SelfEvaluationArtifacts } from './selfEvaluationArtifacts.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
export const SELF_EVAL_MODEL = readServerEnv('SELF_EVAL_MODEL', 'gpt-5.4')

type EvalIssue = {
  severity: 'high' | 'medium' | 'low'
  title: string
  details: string
  recommendation: string
}

type EvalTask = {
  priority: 'high' | 'medium' | 'low'
  title: string
  action: string
}

type EvalRubricDimension = {
  score: number
  diagnosis: string
}

export type EvalRubric = {
  leadershipQuality: EvalRubricDimension
  learningGoalAlignment: EvalRubricDimension
  storyArcQuality: EvalRubricDimension
  topicThreadHandling: EvalRubricDimension
}

export type SelfEvaluationResult = {
  score: number
  rubric: EvalRubric
  overallAssessment: string
  strengths: string[]
  issues: EvalIssue[]
  tasks: EvalTask[]
}

const defaultRubric = (): EvalRubric => ({
  leadershipQuality: { score: 0, diagnosis: 'Keine Rubric-Daten erhalten.' },
  learningGoalAlignment: { score: 0, diagnosis: 'Keine Rubric-Daten erhalten.' },
  storyArcQuality: { score: 0, diagnosis: 'Keine Rubric-Daten erhalten.' },
  topicThreadHandling: { score: 0, diagnosis: 'Keine Rubric-Daten erhalten.' },
})

let cachedPrompt: string | null = null
const loadSelfEvaluationPrompt = async (): Promise<string> => {
  if (cachedPrompt) return cachedPrompt
  const promptPath = path.resolve(workspaceRoot, 'content/prompts/runtime/self-evaluation-system.md')
  cachedPrompt = await readFile(promptPath, 'utf8')
  return cachedPrompt
}

const fallbackEvaluation = (reason: string): SelfEvaluationResult => ({
  score: 0,
  rubric: defaultRubric(),
  overallAssessment: `Self-Evaluation konnte nicht automatisch bewertet werden (${reason}).`,
  strengths: [],
  issues: [
    {
      severity: 'high',
      title: 'Evaluation fehlgeschlagen',
      details: reason,
      recommendation: 'API-Setup und Prompt-Response pruefen und Run erneut starten.',
    },
  ],
  tasks: [
    {
      priority: 'high',
      title: 'Evaluation-Retry',
      action: 'Self-Eval-Run mit gueltigem API-Key erneut ausfuehren.',
    },
  ],
})

type JudgePayload = {
  scenarioIds: string[]
  conversationId: string
  characterId: string
  executionMode: string
  assistantGenerationSource: string
  voicePromptPath: string
  voicePromptLength: number
  conversationHistory: string
  publicActivities: string
  images: string
  runtimeContext: string
  evaluationFocus: string
}

export const buildSelfEvaluationJudgePayload = (
  artifacts: SelfEvaluationArtifacts,
): JudgePayload => ({
  scenarioIds: artifacts.scenarioIds,
  conversationId: artifacts.conversationId,
  characterId: artifacts.characterId,
  executionMode: artifacts.executionMode,
  assistantGenerationSource: artifacts.assistantGenerationSource,
  voicePromptPath: artifacts.voicePromptPath,
  voicePromptLength: artifacts.voicePromptLength,
  conversationHistory: artifacts.conversationHistoryText,
  publicActivities: artifacts.publicActivitiesText,
  images: artifacts.imageEvidenceText,
  runtimeContext: artifacts.runtimeContextText,
  evaluationFocus: artifacts.evaluationFocusText,
})

const normalizeSeverity = (value: unknown): EvalIssue['severity'] => {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'medium'
}

const normalizePriority = (value: unknown): EvalTask['priority'] => {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return 'medium'
}

const normalizeScore = (value: unknown): number => {
  const scoreCandidate = Number(value)
  if (!Number.isFinite(scoreCandidate)) return 0
  return Math.max(0, Math.min(10, scoreCandidate))
}

const normalizeRubricDimension = (value: unknown): EvalRubricDimension => {
  const fallback = { score: 0, diagnosis: 'Keine Detailbewertung erhalten.' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback
  const entry = value as Record<string, unknown>
  return {
    score: normalizeScore(entry.score),
    diagnosis:
      typeof entry.diagnosis === 'string' && entry.diagnosis.trim().length > 0
        ? entry.diagnosis.trim()
        : fallback.diagnosis,
  }
}

const normalizeResult = (raw: Record<string, unknown>): SelfEvaluationResult => {
  const score = normalizeScore(raw.score)
  const rawRubric =
    raw.rubric && typeof raw.rubric === 'object' && !Array.isArray(raw.rubric)
      ? (raw.rubric as Record<string, unknown>)
      : {}
  const rubric: EvalRubric = {
    leadershipQuality: normalizeRubricDimension(rawRubric.leadershipQuality),
    learningGoalAlignment: normalizeRubricDimension(rawRubric.learningGoalAlignment),
    storyArcQuality: normalizeRubricDimension(rawRubric.storyArcQuality),
    topicThreadHandling: normalizeRubricDimension(rawRubric.topicThreadHandling),
  }
  const overallAssessment =
    typeof raw.overallAssessment === 'string'
      ? raw.overallAssessment.trim()
      : 'Keine Gesamtbeurteilung erhalten.'
  const strengths = Array.isArray(raw.strengths)
    ? raw.strengths
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : []
  const issues = Array.isArray(raw.issues)
    ? raw.issues
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        .map((entry) => ({
          severity: normalizeSeverity(entry.severity),
          title: typeof entry.title === 'string' ? entry.title.trim() : '',
          details: typeof entry.details === 'string' ? entry.details.trim() : '',
          recommendation:
            typeof entry.recommendation === 'string' ? entry.recommendation.trim() : '',
        }))
        .filter((entry) => entry.title.length > 0)
    : []
  const tasks = Array.isArray(raw.tasks)
    ? raw.tasks
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
        .map((entry) => ({
          priority: normalizePriority(entry.priority),
          title: typeof entry.title === 'string' ? entry.title.trim() : '',
          action: typeof entry.action === 'string' ? entry.action.trim() : '',
        }))
        .filter((entry) => entry.title.length > 0)
    : []
  return {
    score,
    rubric,
    overallAssessment,
    strengths,
    issues,
    tasks,
  }
}

export const runSelfEvaluationJudge = async (
  artifacts: SelfEvaluationArtifacts,
): Promise<SelfEvaluationResult> => {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return fallbackEvaluation('OPENAI_API_KEY fehlt')

  const prompt = await loadSelfEvaluationPrompt()
  const payload = buildSelfEvaluationJudgePayload(artifacts)
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: SELF_EVAL_MODEL,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 1800,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    return fallbackEvaluation(`HTTP ${response.status}: ${text}`)
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = body.choices?.[0]?.message?.content
  if (!raw) return fallbackEvaluation('Keine Model-Antwort erhalten')

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return normalizeResult(parsed)
  } catch {
    return fallbackEvaluation('Model-Antwort war kein gueltiges JSON')
  }
}
