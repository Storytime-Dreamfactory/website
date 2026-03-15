import {
  CHARACTER_AGENT_SKILL_PLAYBOOKS,
  getCharacterAgentSkillPlaybook,
  type CharacterAgentSkillPlaybookId,
} from '../../characterAgentDefinitions.ts'
import { createActivity } from '../../activityStore.ts'
import { toPublicConversationHistory } from '../../conversationActivityHelpers.ts'
import { contextFromMetadata } from '../../conversationRuntimeContext.ts'
import { getConversationDetails } from '../../conversationStore.ts'
import { getOpenAiApiKey, readServerEnv } from '../../openAiConfig.ts'
import { loadCharacterRuntimeProfile, loadLearningGoalRuntimeProfiles } from '../../runtimeContentStore.ts'
import { trackTraceActivitySafely } from '../../traceActivity.ts'
import type { SceneCharacterContext, SceneRelationshipContext } from '../skills/createSceneBuilder.ts'
import { executeRoutedSkill } from '../skills/skillExecutor.ts'
import {
  readActivitiesRuntimeTool,
  readRelatedObjectsRuntimeTool,
  readRelationshipsRuntimeTool,
} from '../tools/runtimeToolRegistry.ts'

const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const RUNTIME_AUTONOMOUS_MODEL = readServerEnv('RUNTIME_AUTONOMOUS_MODEL', 'gpt-5.4')
const RUNTIME_AUTONOMOUS_ENABLE_USER_TURN_TOOLS =
  readServerEnv('RUNTIME_AUTONOMOUS_ENABLE_USER_TURN_TOOLS', 'false').toLowerCase() === 'true'
const parsedTimeout = Number(process.env.RUNTIME_AUTONOMOUS_TIMEOUT_MS ?? 15_000)
const RUNTIME_AUTONOMOUS_TIMEOUT_MS =
  Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 15_000

type AutonomousRuntimeInput = {
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  eventType?: string
  messageId?: number
}

type AutonomousPlan = {
  activitiesRequested: boolean
  relationshipsRequested: boolean
  skillId: CharacterAgentSkillPlaybookId | null
  reason: string
  selectedLearningGoalId?: string
  openTopicHint?: string
}

const processedUserMessageIdsByConversation = new Map<string, Set<number>>()
const pendingUserTurnPlans = new Map<
  string,
  {
    plan: AutonomousPlan
    lastUserText: string
    relationshipContext: SceneRelationshipContext | null
    effectiveLearningGoalIds: string[]
  }
>()

const hasProcessedUserMessage = (conversationId: string, messageId: number | undefined): boolean => {
  if (!Number.isFinite(messageId)) return false
  return processedUserMessageIdsByConversation.get(conversationId)?.has(messageId as number) ?? false
}

const markUserMessageProcessed = (conversationId: string, messageId: number | undefined): void => {
  if (!Number.isFinite(messageId)) return
  const set = processedUserMessageIdsByConversation.get(conversationId) ?? new Set<number>()
  set.add(messageId as number)
  if (set.size > 1000) {
    const recent = Array.from(set).slice(-500)
    processedUserMessageIdsByConversation.set(conversationId, new Set(recent))
    return
  }
  processedUserMessageIdsByConversation.set(conversationId, set)
}

const parseJsonObject = (raw: string): Record<string, unknown> | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

const toSkillId = (value: unknown): CharacterAgentSkillPlaybookId | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (
    normalized === 'remember-something' ||
    normalized === 'create_scene' ||
    normalized === 'request-context' ||
    normalized === 'evaluate-feedback'
  ) {
    return normalized
  }
  return null
}

const requestAutonomousPlan = async (input: {
  characterName: string
  lastUserText: string
  assistantText: string
  publicHistory: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>
  activeLearningGoalIds: string[]
}): Promise<AutonomousPlan | null> => {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RUNTIME_AUTONOMOUS_TIMEOUT_MS)
  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: RUNTIME_AUTONOMOUS_MODEL,
        messages: [
          {
            role: 'system',
            content: [
              'Du bist der Runtime-Planer fuer einen Character-Agent.',
              'Ziel: kindgerechte, sichere, konsistente Story-Fortsetzung.',
              'Plane offen und objective-orientiert.',
              'Waehle genau einen Skill oder null, und gib an, ob Activities/Relationships vorher geladen werden sollen.',
              'Antworte nur mit JSON gemaess Schema.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: JSON.stringify({
              characterName: input.characterName,
              objectives: [
                'In Character bleiben',
                'Kindgerecht und sicher sprechen',
                'Story-Kontinuitaet sichern',
                'Bei Bedarf sichtbar machen (Bild/Erinnerung)',
                'Lernziel nur priorisieren, wenn aktiv',
              ],
              lastUserText: input.lastUserText,
              assistantDraft: input.assistantText,
              publicHistory: input.publicHistory.slice(-10),
              activeLearningGoalIds: input.activeLearningGoalIds,
              allowedSkillIds: [
                'remember-something',
                'create_scene',
                'request-context',
                'evaluate-feedback',
              ],
            }),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'autonomous_runtime_plan',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                activitiesRequested: { type: 'boolean' },
                relationshipsRequested: { type: 'boolean' },
                skillId: {
                  anyOf: [
                    {
                      type: 'string',
                      enum: [
                        'remember-something',
                        'create_scene',
                        'request-context',
                        'evaluate-feedback',
                      ],
                    },
                    { type: 'null' },
                  ],
                },
                reason: { type: 'string' },
                selectedLearningGoalId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                openTopicHint: { anyOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: [
                'activitiesRequested',
                'relationshipsRequested',
                'skillId',
                'reason',
                'selectedLearningGoalId',
                'openTopicHint',
              ],
            },
          },
        },
      }),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const raw = body.choices?.[0]?.message?.content
    if (typeof raw !== 'string') return null
    const parsed = parseJsonObject(raw)
    if (!parsed) return null
    const skillId = toSkillId(parsed.skillId)
    const reason =
      typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : 'autonomous-plan'
    const selectedLearningGoalId =
      typeof parsed.selectedLearningGoalId === 'string' && parsed.selectedLearningGoalId.trim()
        ? parsed.selectedLearningGoalId.trim()
        : undefined
    const openTopicHint =
      typeof parsed.openTopicHint === 'string' && parsed.openTopicHint.trim()
        ? parsed.openTopicHint.trim()
        : undefined
    return {
      activitiesRequested: parsed.activitiesRequested === true,
      relationshipsRequested: parsed.relationshipsRequested === true,
      skillId,
      reason,
      ...(selectedLearningGoalId ? { selectedLearningGoalId } : {}),
      ...(openTopicHint ? { openTopicHint } : {}),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const trackRuntimeActivitySafely = async (input: {
  activityType: string
  characterId: string
  characterName: string
  conversationId: string
  learningGoalIds?: string[]
  object?: Record<string, unknown>
  metadata?: Record<string, unknown>
}): Promise<void> => {
  try {
    await createActivity({
      activityType: input.activityType,
      isPublic: false,
      characterId: input.characterId,
      conversationId: input.conversationId,
      learningGoalIds: input.learningGoalIds,
      subject: {
        type: 'character',
        id: input.characterId,
        name: input.characterName,
      },
      object: input.object,
      metadata: input.metadata,
    })
  } catch {
    // keep resilient
  }
}

export const runAutonomousRuntimePipeline = async (
  input: AutonomousRuntimeInput,
): Promise<{ handled: boolean }> => {
  if (input.role === 'system') return { handled: false }
  if (input.role === 'user' && !RUNTIME_AUTONOMOUS_ENABLE_USER_TURN_TOOLS) {
    return { handled: false }
  }

  const details = await getConversationDetails(input.conversationId)
  const runtimeContext = contextFromMetadata(details.conversation.metadata)
  const characterId = details.conversation.characterId
  const characterProfile = await loadCharacterRuntimeProfile(characterId)
  const characterName = characterProfile?.name ?? characterId
  const characterContext: SceneCharacterContext | undefined = characterProfile
    ? {
        name: characterProfile.name,
        species: characterProfile.species,
        shortDescription: characterProfile.shortDescription,
        coreTraits: characterProfile.coreTraits,
        temperament: characterProfile.temperament,
        socialStyle: characterProfile.socialStyle,
        quirks: characterProfile.quirks,
        strengths: characterProfile.strengths,
        weaknesses: characterProfile.weaknesses,
        visibleGoal: characterProfile.visibleGoal,
        fear: characterProfile.fear,
      }
    : undefined
  const lastUserText =
    [...details.messages].reverse().find((item) => item.role === 'user')?.content?.trim() ?? ''
  const publicHistory = toPublicConversationHistory(details.messages)

  if (input.role === 'user') {
    if (hasProcessedUserMessage(input.conversationId, input.messageId)) {
      return { handled: true }
    }
    const userTurnPlan = await requestAutonomousPlan({
      characterName,
      lastUserText: input.content,
      assistantText: '',
      publicHistory: publicHistory.map((item) => ({
        role: item.role,
        content: item.content,
        createdAt: item.createdAt,
      })),
      activeLearningGoalIds: runtimeContext.learningGoalIds ?? [],
    })

    await trackTraceActivitySafely({
      activityType: 'trace.runtime.autonomy.user_turn.plan',
      summary: 'Autonomy User-Turn Plan erstellt',
      conversationId: input.conversationId,
      characterId,
      characterName,
      learningGoalIds: runtimeContext.learningGoalIds,
      traceStage: 'routing',
      traceKind: 'decision',
      traceSource: 'runtime',
      input: {
        userText: input.content,
        messageId: input.messageId,
      },
      output: {
        plan: userTurnPlan,
      },
      ok: true,
    })

    if (!userTurnPlan?.skillId) {
      markUserMessageProcessed(input.conversationId, input.messageId)
      return { handled: true }
    }

    const selectedLearningGoalId = userTurnPlan.selectedLearningGoalId
    const effectiveLearningGoalIds = selectedLearningGoalId
      ? Array.from(new Set([selectedLearningGoalId, ...(runtimeContext.learningGoalIds ?? [])]))
      : (runtimeContext.learningGoalIds ?? [])

    let relationshipContext: SceneRelationshipContext | null = null
    if (userTurnPlan.relationshipsRequested) {
      const runtimeToolContext = {
        characterId,
        characterName,
        conversationId: input.conversationId,
        learningGoalIds: runtimeContext.learningGoalIds,
      }
      const relationshipResult = await readRelationshipsRuntimeTool().execute(runtimeToolContext, {})
      const relatedObjectsResult = await readRelatedObjectsRuntimeTool().execute(runtimeToolContext, {
        relatedCharacterIds: relationshipResult.relatedCharacterIds,
        relationshipLinks: relationshipResult.relationshipLinks,
      })
      relationshipContext = {
        relationshipLinks: relationshipResult.relationshipLinks,
        directRelatedObjects: relatedObjectsResult.relatedObjects,
      }
    }
    if (userTurnPlan.activitiesRequested) {
      const runtimeToolContext = {
        characterId,
        characterName,
        conversationId: input.conversationId,
        learningGoalIds: runtimeContext.learningGoalIds,
      }
      await readActivitiesRuntimeTool().execute(runtimeToolContext, { limit: 12 })
    }

    pendingUserTurnPlans.set(input.conversationId, {
      plan: userTurnPlan,
      lastUserText: input.content,
      relationshipContext,
      effectiveLearningGoalIds,
    })
    markUserMessageProcessed(input.conversationId, input.messageId)

    await trackTraceActivitySafely({
      activityType: 'trace.runtime.autonomy.user_turn.preloaded',
      summary: 'Autonomy User-Turn Kontext vorgeladen',
      conversationId: input.conversationId,
      characterId,
      characterName,
      learningGoalIds: runtimeContext.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'response',
      traceSource: 'runtime',
      output: {
        skillId: userTurnPlan.skillId,
        activitiesRequested: userTurnPlan.activitiesRequested,
        relationshipsRequested: userTurnPlan.relationshipsRequested,
        preloaded: true,
      },
      ok: true,
    })

    return { handled: true }
  }

  const pendingUserTurnPlan = pendingUserTurnPlans.get(input.conversationId)
  const plan = pendingUserTurnPlan?.plan
    ? pendingUserTurnPlan.plan
    : await requestAutonomousPlan({
        characterName,
        lastUserText,
        assistantText: input.content,
        publicHistory: publicHistory.map((item) => ({
          role: item.role,
          content: item.content,
          createdAt: item.createdAt,
        })),
        activeLearningGoalIds: runtimeContext.learningGoalIds ?? [],
      })

  await trackTraceActivitySafely({
    activityType: 'trace.runtime.autonomy.plan',
    summary: 'Autonomy-Plan erstellt',
    conversationId: input.conversationId,
    characterId,
    characterName,
    learningGoalIds: runtimeContext.learningGoalIds,
    traceStage: 'routing',
    traceKind: 'decision',
    traceSource: 'runtime',
    input: {
      lastUserText,
      assistantText: input.content,
      usedPendingUserTurnPlan: Boolean(pendingUserTurnPlan),
    },
    output: {
      plan,
    },
    ok: true,
  })

  if (!plan?.skillId) {
    pendingUserTurnPlans.delete(input.conversationId)
    return { handled: true }
  }

  const selectedLearningGoalId = plan.selectedLearningGoalId
  const effectiveLearningGoalIds = pendingUserTurnPlan?.effectiveLearningGoalIds
    ? pendingUserTurnPlan.effectiveLearningGoalIds
    : selectedLearningGoalId
      ? Array.from(new Set([selectedLearningGoalId, ...(runtimeContext.learningGoalIds ?? [])]))
      : (runtimeContext.learningGoalIds ?? [])
  const effectiveLearningGoals = await loadLearningGoalRuntimeProfiles(effectiveLearningGoalIds)
  const selectedLearningGoalName =
    selectedLearningGoalId
      ? effectiveLearningGoals.find((item) => item.id === selectedLearningGoalId)?.name
      : undefined

  let relationshipContext: SceneRelationshipContext | null =
    pendingUserTurnPlan?.relationshipContext ?? null
  let relationshipCount = 0
  let recentActivityCount = 0

  if (plan.relationshipsRequested && !relationshipContext) {
    const runtimeToolContext = {
      characterId,
      characterName,
      conversationId: input.conversationId,
      learningGoalIds: runtimeContext.learningGoalIds,
    }
    const relationshipResult = await readRelationshipsRuntimeTool().execute(runtimeToolContext, {})
    relationshipCount = relationshipResult.relationshipCount
    const relatedObjectsResult = await readRelatedObjectsRuntimeTool().execute(runtimeToolContext, {
      relatedCharacterIds: relationshipResult.relatedCharacterIds,
      relationshipLinks: relationshipResult.relationshipLinks,
    })
    relationshipContext = {
      relationshipLinks: relationshipResult.relationshipLinks,
      directRelatedObjects: relatedObjectsResult.relatedObjects,
    }
  }
  if (plan.activitiesRequested) {
    const runtimeToolContext = {
      characterId,
      characterName,
      conversationId: input.conversationId,
      learningGoalIds: runtimeContext.learningGoalIds,
    }
    const activityResult = await readActivitiesRuntimeTool().execute(runtimeToolContext, { limit: 12 })
    recentActivityCount = activityResult.activityCount
  }

  const playbook = getCharacterAgentSkillPlaybook(plan.skillId)
  await trackRuntimeActivitySafely({
    activityType: 'runtime.skill.routed',
    characterId,
    characterName,
    conversationId: input.conversationId,
    learningGoalIds: runtimeContext.learningGoalIds,
    object: {
      type: 'skill',
      id: plan.skillId,
      name: playbook?.name ?? plan.skillId,
    },
    metadata: {
      summary: `${characterName} waehlt (autonomy) den Skill ${plan.skillId}`,
      pipeline: 'autonomous',
      skillId: plan.skillId,
      toolIds: playbook?.toolIds ?? [],
      reason: plan.reason,
      selectedLearningGoalId: selectedLearningGoalId ?? null,
      selectedLearningGoalName: selectedLearningGoalName ?? null,
      openTopicHint: plan.openTopicHint ?? null,
      activeLearningGoalIds: effectiveLearningGoals.map((item) => item.id),
      activeLearningGoalNames: effectiveLearningGoals.map((item) => item.name),
      suitableLearningGoalIds: characterProfile?.suitableLearningGoalIds ?? [],
      availableSkillIds: CHARACTER_AGENT_SKILL_PLAYBOOKS.map((item) => item.id),
      relationshipCount,
      recentActivityCount,
      sourceEventType: input.eventType,
    },
  })

  await executeRoutedSkill({
    conversationId: input.conversationId,
    decision: {
      skillId: plan.skillId,
      reason: plan.reason,
    },
    assistantText: input.content,
    lastUserText: pendingUserTurnPlan?.lastUserText ?? lastUserText,
    eventType: input.eventType,
    characterId,
    characterName,
    characterContext,
    learningGoalIds: effectiveLearningGoalIds,
    relationshipContext,
  })
  pendingUserTurnPlans.delete(input.conversationId)

  await trackTraceActivitySafely({
    activityType: 'trace.runtime.autonomy.executed',
    summary: 'Autonomy-Pipeline ausgefuehrt',
    conversationId: input.conversationId,
    characterId,
    characterName,
    learningGoalIds: runtimeContext.learningGoalIds,
    traceStage: 'egress',
    traceKind: 'response',
    traceSource: 'runtime',
    output: {
      skillId: plan.skillId,
      reason: plan.reason,
      relationshipsRequested: plan.relationshipsRequested,
      activitiesRequested: plan.activitiesRequested,
      usedPendingUserTurnPlan: Boolean(pendingUserTurnPlan),
    },
    ok: true,
  })

  return { handled: true }
}

