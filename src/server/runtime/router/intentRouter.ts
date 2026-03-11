import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CharacterAgentSkillPlaybookId } from '../../characterAgentDefinitions.ts'
import { getOpenAiApiKey, readServerEnv } from '../../openAiConfig.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)))

let cachedRouterPrompt: string | null = null
const loadRouterSystemPrompt = async (): Promise<string> => {
  if (cachedRouterPrompt) return cachedRouterPrompt
  const promptPath = path.resolve(workspaceRoot, 'content/prompts/runtime/intent-router-system.md')
  cachedRouterPrompt = await readFile(promptPath, 'utf8')
  return cachedRouterPrompt
}

export type RoutedSkillDecision = {
  skillId: CharacterAgentSkillPlaybookId
  reason: string
}

export type RuntimeIntentContextFlags = {
  relationshipsRequested: boolean
  activitiesRequested: boolean
}

export type RuntimeIntentPublicMessage = {
  role: 'user' | 'assistant'
  content: string
  eventType?: string
  createdAt: string
}

export type RuntimeIntentModelDecision = {
  decision: RoutedSkillDecision | null
  flags: RuntimeIntentContextFlags
  source: 'llm-primary' | 'llm-secondary' | 'fallback'
  pass: 'primary' | 'secondary' | 'fallback'
  secondaryUsed: boolean
  primaryDecision: RoutedSkillDecision | null
  secondaryDecision: RoutedSkillDecision | null
  primaryFailureReason: string | null
  secondaryFailureReason: string | null
}

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const RUNTIME_INTENT_MODEL = readServerEnv('RUNTIME_INTENT_MODEL', 'gpt-5.4')
const parsedRuntimeIntentTimeout = Number(process.env.RUNTIME_INTENT_TIMEOUT_MS ?? 15_000)
const RUNTIME_INTENT_TIMEOUT_MS =
  Number.isFinite(parsedRuntimeIntentTimeout) && parsedRuntimeIntentTimeout > 0
    ? parsedRuntimeIntentTimeout
    : 15_000
const parsedRuntimeIntentRetries = Number(process.env.RUNTIME_INTENT_RETRIES ?? 1)
const RUNTIME_INTENT_RETRIES =
  Number.isFinite(parsedRuntimeIntentRetries) && parsedRuntimeIntentRetries >= 0
    ? Math.floor(parsedRuntimeIntentRetries)
    : 1

type RuntimeIntentLlmAttemptResult = {
  decision: RuntimeIntentModelDecision | null
  failureReason: string | null
}

const toNormalizedSkillId = (value: unknown): CharacterAgentSkillPlaybookId | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'remember-something') return 'remember-something'
  if (normalized === 'create_scene') return 'create_scene'
  if (normalized === 'request-context') return 'request-context'
  if (normalized === 'evaluate-feedback') return 'evaluate-feedback'
  if (normalized === 'guided-explanation') return 'remember-something'
  if (normalized === 'visual-expression') return 'create_scene'
  if (normalized === 'run-quiz') return 'create_scene'
  if (normalized === 'micro-reflection') return 'request-context'
  return null
}

const parseJsonObject = (raw: string): Record<string, unknown> | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    const parsed = JSON.parse(withoutFence)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

const parseDecisionFromJsonObject = (
  parsed: Record<string, unknown> | null,
  options: {
    forceSkillChoice: boolean
    source: RuntimeIntentModelDecision['source']
    pass: RuntimeIntentModelDecision['pass']
    secondaryUsed: boolean
    primaryDecision: RoutedSkillDecision | null
    secondaryDecision: RoutedSkillDecision | null
    primaryFailureReason: string | null
    secondaryFailureReason: string | null
  },
): RuntimeIntentModelDecision | null => {
  if (!parsed) return null
  const skillId = toNormalizedSkillId(parsed.skillId)
  if (options.forceSkillChoice && !skillId) return null
  const reason =
    typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : 'model'
  return {
    decision: skillId ? { skillId, reason } : null,
    flags: {
      activitiesRequested: parsed.activitiesRequested === true,
      relationshipsRequested: parsed.relationshipsRequested === true,
    },
    source: options.source,
    pass: options.pass,
    secondaryUsed: options.secondaryUsed,
    primaryDecision: options.primaryDecision,
    secondaryDecision: options.secondaryDecision,
    primaryFailureReason: options.primaryFailureReason,
    secondaryFailureReason: options.secondaryFailureReason,
  }
}

const responseSchema = (forceSkillChoice: boolean): Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    activitiesRequested: { type: 'boolean' },
    relationshipsRequested: { type: 'boolean' },
    skillId: forceSkillChoice
      ? {
          type: 'string',
          enum: ['remember-something', 'create_scene', 'request-context', 'evaluate-feedback'],
        }
      : {
          anyOf: [
            {
              type: 'string',
              enum: ['remember-something', 'create_scene', 'request-context', 'evaluate-feedback'],
            },
            { type: 'null' },
          ],
        },
    reason: { type: 'string' },
  },
  required: ['activitiesRequested', 'relationshipsRequested', 'skillId', 'reason'],
})

const requestRuntimeIntentFromLlm = async (
  lastUserText: string,
  assistantText: string,
  publicConversationHistory: RuntimeIntentPublicMessage[],
  options: { forceSkillChoice: boolean; pass: 'primary' | 'secondary' },
): Promise<RuntimeIntentLlmAttemptResult> => {
  if (process.env.NODE_ENV === 'test' && process.env.RUNTIME_INTENT_ALLOW_TEST_NETWORK !== 'true') {
    return {
      decision: null,
      failureReason: 'test-mode-disabled',
    }
  }
  const apiKey = getOpenAiApiKey()
  if (!apiKey) {
    return {
      decision: null,
      failureReason: 'missing-openai-api-key',
    }
  }
  const basePrompt = await loadRouterSystemPrompt()
  const systemPrompt = options.forceSkillChoice
    ? `${basePrompt}\n\nDu MUSST genau ein skillId auswaehlen. skillId darf NICHT null sein.`
    : `${basePrompt}\n\nWaehle skillId passend zur Anfrage aus. Bei reiner Kontextabfrage ist request-context korrekt.`

  let lastFailureReason: string | null = null
  for (let attempt = 0; attempt <= RUNTIME_INTENT_RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), RUNTIME_INTENT_TIMEOUT_MS)
    try {
      const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: RUNTIME_INTENT_MODEL,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: JSON.stringify({
                lastUserText,
                assistantText,
                publicConversationHistory,
                allowedSkillIds: [
                  'remember-something',
                  'create_scene',
                  'request-context',
                  'evaluate-feedback',
                ],
                outputRules: {
                  mustReturnJsonOnly: true,
                  activitiesRequested: 'boolean',
                  relationshipsRequested: 'boolean',
                  skillIdOrNull: options.forceSkillChoice ? 'string' : 'string|null',
                  reason: 'string',
                },
              }),
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'runtime_intent_decision',
              strict: true,
              schema: responseSchema(options.forceSkillChoice),
            },
          },
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          decision: null,
          failureReason: errorText
            ? `http-${response.status}:${errorText.slice(0, 220)}`
            : `http-${response.status}`,
        }
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = body?.choices?.[0]?.message?.content
      if (typeof content !== 'string') {
        return {
          decision: null,
          failureReason: 'empty-content',
        }
      }
      const rawParsed = parseJsonObject(content)
      if (!rawParsed) {
        return {
          decision: null,
          failureReason: 'invalid-json',
        }
      }
      const parsed = parseDecisionFromJsonObject(rawParsed, {
        forceSkillChoice: options.forceSkillChoice,
        source: options.pass === 'primary' ? 'llm-primary' : 'llm-secondary',
        pass: options.pass,
        secondaryUsed: options.pass === 'secondary',
        primaryDecision: null,
        secondaryDecision: null,
        primaryFailureReason: null,
        secondaryFailureReason: null,
      })
      if (!parsed) {
        return {
          decision: null,
          failureReason: 'invalid-schema',
        }
      }
      return {
        decision: parsed,
        failureReason: null,
      }
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError'
      lastFailureReason = isTimeout ? 'timeout' : 'network-error'
      if (attempt >= RUNTIME_INTENT_RETRIES) {
        return {
          decision: null,
          failureReason: lastFailureReason,
        }
      }
    } finally {
      clearTimeout(timeout)
    }
  }
  return {
    decision: null,
    failureReason: lastFailureReason ?? 'network-error',
  }
}

export const isMemoryImageRequest = (): boolean => false
export const isActionRequest = (): boolean => false

export const detectRuntimeIntent = (
  lastUserText: string,
  assistantText: string,
): RoutedSkillDecision | null =>
  parseDecisionFromJsonObject(parseJsonObject(lastUserText), {
    forceSkillChoice: false,
    source: 'fallback',
    pass: 'fallback',
    secondaryUsed: false,
    primaryDecision: null,
    secondaryDecision: null,
    primaryFailureReason: null,
    secondaryFailureReason: null,
  })?.decision ??
  parseDecisionFromJsonObject(parseJsonObject(assistantText), {
    forceSkillChoice: false,
    source: 'fallback',
    pass: 'fallback',
    secondaryUsed: false,
    primaryDecision: null,
    secondaryDecision: null,
    primaryFailureReason: null,
    secondaryFailureReason: null,
  })?.decision ??
  null

export const detectRuntimeIntentContextFlags = (
  lastUserText: string,
  assistantText = '',
): RuntimeIntentContextFlags =>
  parseDecisionFromJsonObject(parseJsonObject(lastUserText), {
    forceSkillChoice: false,
    source: 'fallback',
    pass: 'fallback',
    secondaryUsed: false,
    primaryDecision: null,
    secondaryDecision: null,
    primaryFailureReason: null,
    secondaryFailureReason: null,
  })?.flags ??
  parseDecisionFromJsonObject(parseJsonObject(assistantText), {
    forceSkillChoice: false,
    source: 'fallback',
    pass: 'fallback',
    secondaryUsed: false,
    primaryDecision: null,
    secondaryDecision: null,
    primaryFailureReason: null,
    secondaryFailureReason: null,
  })?.flags ?? {
    relationshipsRequested: false,
    activitiesRequested: false,
  }

export const detectRuntimeIntentModelDecision = async (
  lastUserText: string,
  assistantText: string,
  publicConversationHistory: RuntimeIntentPublicMessage[] = [],
): Promise<RuntimeIntentModelDecision> => {
  const primaryAttempt = await requestRuntimeIntentFromLlm(
    lastUserText,
    assistantText,
    publicConversationHistory,
    {
    forceSkillChoice: false,
    pass: 'primary',
    },
  )
  const primaryDecision = primaryAttempt.decision?.decision ?? null
  const primaryFailureReason = primaryAttempt.failureReason

  if (primaryAttempt.decision?.decision) {
    return {
      ...primaryAttempt.decision,
      secondaryUsed: false,
      primaryDecision,
      secondaryDecision: null,
      primaryFailureReason,
      secondaryFailureReason: null,
    }
  }

  const secondaryAttempt = await requestRuntimeIntentFromLlm(
    lastUserText,
    assistantText,
    publicConversationHistory,
    {
    forceSkillChoice: true,
    pass: 'secondary',
    },
  )
  const secondaryDecision = secondaryAttempt.decision?.decision ?? null
  const secondaryFailureReason = secondaryAttempt.failureReason
  if (secondaryAttempt.decision?.decision) {
    return {
      ...secondaryAttempt.decision,
      secondaryUsed: true,
      primaryDecision,
      secondaryDecision,
      primaryFailureReason,
      secondaryFailureReason,
    }
  }

  const fallbackFromJson =
    parseDecisionFromJsonObject(parseJsonObject(lastUserText), {
      forceSkillChoice: false,
      source: 'fallback',
      pass: 'fallback',
      secondaryUsed: true,
      primaryDecision,
      secondaryDecision,
      primaryFailureReason,
      secondaryFailureReason,
    }) ??
    parseDecisionFromJsonObject(parseJsonObject(assistantText), {
      forceSkillChoice: false,
      source: 'fallback',
      pass: 'fallback',
      secondaryUsed: true,
      primaryDecision,
      secondaryDecision,
      primaryFailureReason,
      secondaryFailureReason,
    })
  return {
    decision: fallbackFromJson?.decision ?? null,
    flags: fallbackFromJson?.flags ?? {
      relationshipsRequested: false,
      activitiesRequested: false,
    },
    source: 'fallback',
    pass: 'fallback',
    secondaryUsed: true,
    primaryDecision,
    secondaryDecision,
    primaryFailureReason,
    secondaryFailureReason,
  }
}

