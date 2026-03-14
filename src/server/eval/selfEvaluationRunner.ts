import {
  appendConversationFlowMessage,
  endConversationFlow,
  startConversationFlow,
} from '../conversationFlowService.ts'
import { inspectConversation } from '../debugConversationReadService.ts'
import type { ConversationInspection } from '../debugConversationReadService.ts'
import { buildSelfEvaluationArtifacts } from './selfEvaluationArtifacts.ts'
import { writeEvalReport } from './evalReportWriter.ts'
import {
  getSelfEvaluationScenario,
  type SelfEvaluationScenarioId,
} from './selfEvaluationScenarios.ts'
import { buildSelfEvaluationRuntimeContextText } from './selfEvaluationRuntimeCatalog.ts'
import {
  runSelfEvaluationJudge,
  SELF_EVAL_MODEL,
  type SelfEvaluationResult,
} from './selfEvaluationJudge.ts'
import { generateCharacterVoiceAssistantText } from '../characterVoiceResponseService.ts'

export type SelfEvaluationRunResult = {
  runIndex: number
  scenarioIds: SelfEvaluationScenarioId[]
  conversationId: string
  reportPath: string
  score: number
  executionMode: 'cli' | 'http'
}

type SelfEvaluationRunnerInput = {
  characterId: string
  userId?: string
  scenarioIds: SelfEvaluationScenarioId[]
  runs: number
  outputDirectory: string
  maxTurns?: number
  executionMode?: 'cli' | 'http'
  baseUrl?: string
}

type RunnerDeps = {
  start: (input: {
    characterId: string
    userId?: string
    metadata?: Record<string, unknown>
  }) => Promise<{ conversationId: string }>
  append: (input: {
    conversationId: string
    role: 'user' | 'assistant' | 'system'
    content: string
    eventType?: string
    metadata?: Record<string, unknown>
  }) => Promise<void>
  end: (input: { conversationId: string; metadata?: Record<string, unknown> }) => Promise<void>
  inspect: (conversationId: string) => Promise<ConversationInspection | null>
  judge: (artifacts: ReturnType<typeof buildSelfEvaluationArtifacts>) => Promise<SelfEvaluationResult>
  writeReport: typeof writeEvalReport
  log: (line: string) => void
}

const postJson = async <T>(
  baseUrl: string,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> => {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as T) : ({} as T)
  if (!response.ok) {
    throw new Error(`POST ${endpoint} failed (${response.status}): ${text}`)
  }
  return payload
}

const getJson = async <T>(baseUrl: string, endpoint: string): Promise<T> => {
  const response = await fetch(`${baseUrl}${endpoint}`)
  const text = await response.text()
  const payload = text ? (JSON.parse(text) as T) : ({} as T)
  if (!response.ok) {
    throw new Error(`GET ${endpoint} failed (${response.status}): ${text}`)
  }
  return payload
}

const createCliDeps = (): RunnerDeps => ({
  start: async (input) => {
    const { conversation } = await startConversationFlow({
      characterId: input.characterId,
      userId: input.userId,
      metadata: input.metadata,
    })
    return { conversationId: conversation.conversationId }
  },
  append: async (input) => {
    await appendConversationFlowMessage({
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      eventType: input.eventType,
      metadata: input.metadata,
      runRuntimeSynchronously: true,
    })
  },
  end: async (input) => {
    await endConversationFlow({
      conversationId: input.conversationId,
      metadata: input.metadata,
    })
  },
  inspect: inspectConversation,
  judge: runSelfEvaluationJudge,
  writeReport: writeEvalReport,
  log: (line) => console.log(line),
})

const createHttpDeps = (baseUrl: string): RunnerDeps => ({
  start: async (input) => {
    const payload = await postJson<{ conversation?: { conversationId?: string } }>(
      baseUrl,
      '/api/conversations/start',
      {
        characterId: input.characterId,
        userId: input.userId,
        metadata: input.metadata,
      },
    )
    const conversationId = payload.conversation?.conversationId?.trim()
    if (!conversationId) throw new Error('HTTP start lieferte keine conversationId.')
    return { conversationId }
  },
  append: async (input) => {
    await postJson(baseUrl, '/api/conversations/message', {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      eventType: input.eventType,
      metadata: input.metadata,
    })
  },
  end: async (input) => {
    await postJson(baseUrl, '/api/conversations/end', {
      conversationId: input.conversationId,
      metadata: input.metadata,
    })
  },
  inspect: async (conversationId) =>
    getJson(baseUrl, `/api/conversations/inspect?conversationId=${encodeURIComponent(conversationId)}`),
  judge: runSelfEvaluationJudge,
  writeReport: writeEvalReport,
  log: (line) => console.log(line),
})

const defaultDeps: RunnerDeps = {
  ...createCliDeps(),
}

const SELF_EVAL_USER_CHARACTER_ID = 'yoko'

const buildAssistantMetadata = (characterId: string): Record<string, unknown> => ({
  actorType: 'character',
  actorId: characterId,
  source: 'self-eval-cli',
})

export const runSelfEvaluation = async (
  input: SelfEvaluationRunnerInput,
  deps: RunnerDeps = defaultDeps,
): Promise<SelfEvaluationRunResult[]> => {
  const runs = Number.isFinite(input.runs) && input.runs > 0 ? Math.floor(input.runs) : 1
  const maxTurns =
    Number.isFinite(input.maxTurns) && (input.maxTurns as number) > 0
      ? Math.floor(input.maxTurns as number)
      : undefined
  const results: SelfEvaluationRunResult[] = []
  const runtimeContextText = buildSelfEvaluationRuntimeContextText()
  const executionMode = input.executionMode ?? 'cli'
  const effectiveDeps =
    deps === defaultDeps
      ? executionMode === 'http'
        ? createHttpDeps(input.baseUrl?.trim() || 'http://localhost:5173')
        : createCliDeps()
      : deps

  for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
    effectiveDeps.log(`\n[eval] E2E Run ${runIndex}/${runs} gestartet`)
    const { conversationId } = await effectiveDeps.start({
      characterId: input.characterId,
      userId: input.userId,
      metadata: {
        channel: 'self-evaluation-cli',
        counterpartName: 'Yoko',
        counterpartCharacterId: SELF_EVAL_USER_CHARACTER_ID,
        selfEvaluation: true,
        selfEvaluationMode: 'single-e2e-conversation',
        selfEvaluationScenarios: input.scenarioIds,
        selfEvaluationRunIndex: runIndex,
      },
    })
    let voicePromptPath = ''
    let voicePromptLength = 0

    for (const scenarioId of input.scenarioIds) {
      const scenario = getSelfEvaluationScenario(scenarioId)
      effectiveDeps.log(`[eval] Phase ${scenario.id}: ${scenario.title}`)
      const turns = maxTurns ? scenario.turns.slice(0, maxTurns) : scenario.turns

      for (const turn of turns) {
        await effectiveDeps.append({
          conversationId,
          role: 'user',
          content: turn.userText,
          eventType: 'chat.turn',
          metadata: {
            actorType: 'character',
            actorId: SELF_EVAL_USER_CHARACTER_ID,
            source: 'self-eval-cli',
            selfEvaluationScenario: scenario.id,
          },
        })

        const generated = await generateCharacterVoiceAssistantText({
          characterId: input.characterId,
          conversationId,
        })
        voicePromptPath = generated.context.promptInfo.promptPath
        voicePromptLength = generated.context.promptInfo.promptLength

        await effectiveDeps.append({
          conversationId,
          role: 'assistant',
          content: generated.assistantText,
          eventType: 'response.audio_transcript.done',
          metadata: {
            ...buildAssistantMetadata(input.characterId),
            selfEvaluationScenario: scenario.id,
          },
        })
      }
    }

    await effectiveDeps.end({
      conversationId,
      metadata: {
        endReason: 'self-evaluation-finished',
        selfEvaluationMode: 'single-e2e-conversation',
        selfEvaluationScenarios: input.scenarioIds,
        selfEvaluationRunIndex: runIndex,
      },
    })

    const inspection = await effectiveDeps.inspect(conversationId)
    if (!inspection) {
      throw new Error(`Conversation konnte nicht inspiziert werden: ${conversationId}`)
    }

    const artifacts = buildSelfEvaluationArtifacts({
      scenarioIds: input.scenarioIds,
      runtimeContextText,
      executionMode,
      assistantGenerationSource: 'shared-voice-service',
      voicePromptPath,
      voicePromptLength,
      inspection,
    })
    const evaluation = await effectiveDeps.judge(artifacts)
    const reportPath = await effectiveDeps.writeReport({
      outputDirectory: input.outputDirectory,
      characterId: input.characterId,
      scenarioId: `e2e-${input.scenarioIds.join('-')}`,
      conversationId,
      runIndex,
      judgeModel: SELF_EVAL_MODEL,
      artifacts,
      evaluation,
    })

    results.push({
      scenarioIds: input.scenarioIds,
      runIndex,
      conversationId,
      reportPath,
      score: evaluation.score,
      executionMode,
    })
    effectiveDeps.log(`[eval] E2E-Report geschrieben: ${reportPath}`)
  }

  return results
}
