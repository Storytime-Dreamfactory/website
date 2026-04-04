import { createActivity } from './activityStore.ts'
import {
  CHARACTER_AGENT_SKILL_PLAYBOOKS,
  getCharacterAgentSkillPlaybook,
} from './characterAgentDefinitions.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'
import {
  clearExplicitImageRequestForConversation,
  noteExplicitImageRequestFromUserMessage,
} from './conversationSceneImageService.ts'
import { appendConversationMessage, getConversationDetails } from './conversationStore.ts'
import { toPublicConversationHistory } from './conversationActivityHelpers.ts'
import { RUNTIME_TEMPORARY_UNAVAILABLE_MESSAGE, readServerEnv } from './openAiConfig.ts'
import {
  loadCharacterRuntimeProfile,
  loadLearningGoalRuntimeProfiles,
} from './runtimeContentStore.ts'
import {
  readRelatedObjectsRuntimeTool,
  readRelationshipsRuntimeTool,
} from './runtime/tools/runtimeToolRegistry.ts'
import { detectRuntimeIntentModelDecision } from './runtime/router/intentRouter.ts'
import { runAutonomousRuntimePipeline } from './runtime/autonomy/autonomousRuntimePipeline.ts'
import {
  executeRoutedSkill,
  scheduleMemoryImageRecallFromUserTurn,
} from './runtime/skills/skillExecutor.ts'
import { trackTraceActivitySafely } from './traceActivity.ts'
import type { SceneCharacterContext, SceneRelationshipContext } from './runtime/skills/createSceneBuilder.ts'
import type {
  RoutedSkillDecision,
  RuntimeIntentPublicMessage,
} from './runtime/router/intentRouter.ts'

type OrchestrateCharacterRuntimeTurnInput = {
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  eventType?: string
  messageId?: number
  actorType?: string
  actorId?: string
}

const processedAssistantMessageIds = new Map<string, Set<number>>()
const pendingSelfAssistantSceneDecisions = new Map<
  string,
  { decision: RoutedSkillDecision; lastUserText: string; userMessageId?: number }
>()
const pendingOpenTopicHints = new Map<string, string>()
const userTurnSceneExecutionInFlight = new Set<string>()
const RUNTIME_AUTONOMOUS_PIPELINE_ENABLED =
  readServerEnv('RUNTIME_AUTONOMOUS_PIPELINE_ENABLED', 'false').toLowerCase() === 'true' &&
  (process.env.NODE_ENV !== 'test' || process.env.RUNTIME_AUTONOMOUS_PIPELINE_ALLOW_TEST === 'true')

const hasProcessedAssistantMessage = (conversationId: string, messageId: number | undefined): boolean => {
  if (!Number.isFinite(messageId)) return false
  return processedAssistantMessageIds.get(conversationId)?.has(messageId as number) ?? false
}

const markAssistantMessageProcessed = (conversationId: string, messageId: number | undefined): void => {
  if (!Number.isFinite(messageId)) return
  const set = processedAssistantMessageIds.get(conversationId) ?? new Set<number>()
  set.add(messageId as number)
  // Keep only recent ids per conversation to avoid unbounded growth.
  if (set.size > 1000) {
    const items = Array.from(set.values()).slice(-500)
    processedAssistantMessageIds.set(conversationId, new Set(items))
    return
  }
  processedAssistantMessageIds.set(conversationId, set)
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Runtime activity tracking failed: ${message}`)
  }
}

export const orchestrateCharacterRuntimeTurn = async (
  input: OrchestrateCharacterRuntimeTurnInput,
): Promise<void> => {
  const conversationId = input.conversationId.trim()
  const content = input.content.trim()
  if (!conversationId || !content || input.role === 'system') return
  if (input.role === 'assistant' && hasProcessedAssistantMessage(conversationId, input.messageId)) {
    return
  }
  if (RUNTIME_AUTONOMOUS_PIPELINE_ENABLED) {
    const autonomousResult = await runAutonomousRuntimePipeline({
      conversationId,
      role: input.role,
      content,
      eventType: input.eventType,
      messageId: input.messageId,
    })
    if (autonomousResult.handled) {
      if (input.role === 'assistant') {
        markAssistantMessageProcessed(conversationId, input.messageId)
      }
      return
    }
  }
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'N1',location:'characterRuntimeOrchestrator.ts:orchestrate:start',message:'Runtime-Orchestrierung gestartet',data:{conversationId,role:input.role,eventType:input.eventType ?? null,contentPreview:content.slice(0,120)},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  let publicConversationHistory: RuntimeIntentPublicMessage[] = []
  try {
    const details = await getConversationDetails(conversationId)
    publicConversationHistory = toPublicConversationHistory(details.messages)

    if (input.role === 'assistant') {
      const hasPendingSceneRequest = pendingSelfAssistantSceneDecisions.has(conversationId)
      const precedingMessage = details.messages
        .filter((m) => m.content?.trim() !== content)
        .at(-1)
      const isResponseToGeneratedImage =
        precedingMessage?.role === 'system' &&
        (precedingMessage?.eventType === 'tool.image.generated' ||
          precedingMessage?.eventType === 'tool.image.recalled')
      if (isResponseToGeneratedImage && !hasPendingSceneRequest) {
        markAssistantMessageProcessed(conversationId, input.messageId)
        return
      }
    }
  } catch {
    publicConversationHistory = []
  }

  if (input.role === 'user') {
    await trackTraceActivitySafely({
      activityType: 'trace.runtime.user_turn.request',
      summary: 'Runtime verarbeitet User-Turn',
      conversationId,
      traceStage: 'routing',
      traceKind: 'request',
      traceSource: 'runtime',
      input: {
        contentPreview: content.slice(0, 240),
        eventType: input.eventType,
      },
    })
    const userTurnDecision = await detectRuntimeIntentModelDecision(content, '', publicConversationHistory)
    const memoryRequest = userTurnDecision.decision?.skillId === 'remember-something'
    // #region agent log
    fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'N2',location:'characterRuntimeOrchestrator.ts:orchestrate:user-turn',message:'User-Turn auf Memory-Request geprueft',data:{conversationId,memoryRequest,userText:content},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    if (memoryRequest) {
      pendingSelfAssistantSceneDecisions.delete(conversationId)
      pendingOpenTopicHints.delete(conversationId)
      clearExplicitImageRequestForConversation(conversationId)
      await scheduleMemoryImageRecallFromUserTurn({
        conversationId,
        userText: content,
      })
      await trackTraceActivitySafely({
        activityType: 'trace.runtime.user_turn.decision',
        summary: 'Memory-Request erkannt',
        conversationId,
        traceStage: 'routing',
        traceKind: 'decision',
        traceSource: 'runtime',
        output: {
          memoryRequest: true,
          routingDecisionSource: userTurnDecision.source,
          skillId: userTurnDecision.decision?.skillId ?? null,
          reason: userTurnDecision.decision?.reason ?? null,
        },
        ok: true,
      })
      return
    }
    noteExplicitImageRequestFromUserMessage({
      conversationId,
      userText: content,
    })
    if (userTurnDecision.decision?.openTopicHint) {
      pendingOpenTopicHints.set(conversationId, userTurnDecision.decision.openTopicHint)
    } else if (pendingOpenTopicHints.has(conversationId)) {
      pendingOpenTopicHints.delete(conversationId)
    }
    const isSceneSkill =
      userTurnDecision.decision?.skillId === 'create_scene' ||
      userTurnDecision.decision?.skillId === 'plan-and-act'
    if (isSceneSkill) {
      pendingSelfAssistantSceneDecisions.set(conversationId, {
        decision: userTurnDecision.decision!,
        lastUserText: content,
        userMessageId: input.messageId,
      })
    } else {
      pendingSelfAssistantSceneDecisions.delete(conversationId)
    }
    await trackTraceActivitySafely({
      activityType: 'trace.runtime.user_turn.decision',
      summary: 'Kein Memory-Request, explizite Bildanfrage pruefen',
      conversationId,
      traceStage: 'routing',
      traceKind: 'decision',
      traceSource: 'runtime',
      output: {
        memoryRequest: false,
        routingDecisionSource: userTurnDecision.source,
        skillId: userTurnDecision.decision?.skillId ?? null,
        reason: userTurnDecision.decision?.reason ?? null,
        selectedLearningGoalId: userTurnDecision.decision?.selectedLearningGoalId ?? null,
        openTopicHint: userTurnDecision.decision?.openTopicHint ?? null,
        secondaryUsed: userTurnDecision.secondaryUsed,
        primaryDecision: userTurnDecision.primaryDecision?.skillId ?? null,
        secondaryDecision: userTurnDecision.secondaryDecision?.skillId ?? null,
        primaryFailureReason: userTurnDecision.primaryFailureReason,
        secondaryFailureReason: userTurnDecision.secondaryFailureReason,
        immediateSceneExecution: isSceneSkill,
      },
      ok: true,
    })
    if (isSceneSkill && userTurnDecision.decision) {
      const sceneDetails = await getConversationDetails(conversationId)
      const sceneRuntimeContext = contextFromMetadata(sceneDetails.conversation.metadata)
      const sceneCharacterId = sceneDetails.conversation.characterId
      const sceneCharacterProfile = await loadCharacterRuntimeProfile(sceneCharacterId)
      const sceneCharacterName = sceneCharacterProfile?.name ?? sceneCharacterId
      const sceneCharacterContext: SceneCharacterContext | undefined = sceneCharacterProfile
        ? {
            name: sceneCharacterProfile.name,
            species: sceneCharacterProfile.species,
            shortDescription: sceneCharacterProfile.shortDescription,
            coreTraits: sceneCharacterProfile.coreTraits,
            temperament: sceneCharacterProfile.temperament,
            socialStyle: sceneCharacterProfile.socialStyle,
            quirks: sceneCharacterProfile.quirks,
            strengths: sceneCharacterProfile.strengths,
            weaknesses: sceneCharacterProfile.weaknesses,
            visibleGoal: sceneCharacterProfile.visibleGoal,
            fear: sceneCharacterProfile.fear,
          }
        : undefined
      const selectedLearningGoalId = userTurnDecision.decision.selectedLearningGoalId
      const effectiveLearningGoalIds = selectedLearningGoalId
        ? Array.from(new Set([selectedLearningGoalId, ...(sceneRuntimeContext.learningGoalIds ?? [])]))
        : (sceneRuntimeContext.learningGoalIds ?? [])
      userTurnSceneExecutionInFlight.add(conversationId)
      void executeRoutedSkill({
        conversationId,
        decision: userTurnDecision.decision,
        assistantText: '',
        lastUserText: content,
        eventType: input.eventType,
        characterId: sceneCharacterId,
        characterName: sceneCharacterName,
        characterContext: sceneCharacterContext,
        learningGoalIds: effectiveLearningGoalIds,
        relationshipContext: null,
      }).catch((error) => {
        const reason = error instanceof Error ? error.message : String(error)
        console.warn(`Immediate user-turn scene execution failed: ${reason}`)
      }).finally(() => {
        userTurnSceneExecutionInFlight.delete(conversationId)
        pendingSelfAssistantSceneDecisions.delete(conversationId)
      })
    }
    return
  }

  const details = await getConversationDetails(conversationId)
  const runtimeContext = contextFromMetadata(details.conversation.metadata)
  const characterId = details.conversation.characterId
  const pendingSelfSceneDecision = pendingSelfAssistantSceneDecisions.get(conversationId)
  const isSelfAssistantTurn =
    input.role === 'assistant' &&
    input.actorType === 'character' &&
    typeof input.actorId === 'string' &&
    input.actorId.trim() === characterId
  const userTurnAlreadyExecuting = userTurnSceneExecutionInFlight.has(conversationId)
  if (
    isSelfAssistantTurn &&
    (userTurnAlreadyExecuting ||
      !pendingSelfSceneDecision ||
      (pendingSelfSceneDecision.decision.skillId !== 'create_scene' &&
        pendingSelfSceneDecision.decision.skillId !== 'plan-and-act') ||
      pendingSelfSceneDecision.lastUserText.length === 0)
  ) {
    markAssistantMessageProcessed(conversationId, input.messageId)
    await trackTraceActivitySafely({
      activityType: 'trace.runtime.assistant_turn.ignored',
      summary: 'Assistant-Turn des selben Characters ignoriert',
      conversationId,
      characterId,
      characterName: characterId,
      learningGoalIds: runtimeContext.learningGoalIds,
      traceStage: 'routing',
      traceKind: 'decision',
      traceSource: 'runtime',
      input: {
        eventType: input.eventType,
        actorType: input.actorType,
        actorId: input.actorId,
        messageId: input.messageId,
      },
      output: {
        ignored: true,
        reason: userTurnAlreadyExecuting ? 'user-turn-scene-in-flight' : 'self-assistant-turn',
      },
      ok: true,
    })
    return
  }
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
    isSelfAssistantTurn &&
    (pendingSelfSceneDecision?.decision.skillId === 'create_scene' ||
      pendingSelfSceneDecision?.decision.skillId === 'plan-and-act')
      ? pendingSelfSceneDecision.lastUserText
      : ([...details.messages].reverse().find((item) => item.role === 'user')?.content?.trim() ?? '')
  publicConversationHistory = toPublicConversationHistory(details.messages)
  const pendingOpenTopicHint = pendingOpenTopicHints.get(conversationId)
  const runtimeIntentDecision =
    isSelfAssistantTurn &&
    (pendingSelfSceneDecision?.decision.skillId === 'create_scene' ||
      pendingSelfSceneDecision?.decision.skillId === 'plan-and-act')
    ? {
        decision: pendingSelfSceneDecision.decision,
        flags: { relationshipsRequested: false, activitiesRequested: false },
        source: 'fallback' as const,
        pass: 'fallback' as const,
        secondaryUsed: false,
        primaryDecision: pendingSelfSceneDecision.decision,
        secondaryDecision: null,
        primaryFailureReason: null,
        secondaryFailureReason: null,
      }
    : await detectRuntimeIntentModelDecision(
        lastUserText,
        content,
        publicConversationHistory,
      )
  const resolvedOpenTopicHint =
    runtimeIntentDecision.decision?.openTopicHint ?? pendingOpenTopicHint ?? undefined
  const selectedLearningGoalId = runtimeIntentDecision.decision?.selectedLearningGoalId
  const effectiveLearningGoalIds = selectedLearningGoalId
    ? Array.from(new Set([selectedLearningGoalId, ...(runtimeContext.learningGoalIds ?? [])]))
    : (runtimeContext.learningGoalIds ?? [])
  const effectiveLearningGoals = await loadLearningGoalRuntimeProfiles(effectiveLearningGoalIds)
  const selectedLearningGoalName =
    selectedLearningGoalId
      ? effectiveLearningGoals.find((item) => item.id === selectedLearningGoalId)?.name
      : undefined
  const { relationshipsRequested, activitiesRequested } = runtimeIntentDecision.flags

  let relationshipCount = 0
  let relationshipContext: SceneRelationshipContext | null = null
  if (relationshipsRequested) {
    const runtimeToolContext = {
      characterId,
      characterName,
      conversationId,
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

  const recentActivityCount: number | null = null

  const decision = runtimeIntentDecision.decision
  const decisionFailureReason =
    runtimeIntentDecision.secondaryFailureReason ??
    runtimeIntentDecision.primaryFailureReason ??
    (runtimeIntentDecision.source === 'fallback' ? 'llm-intent-unavailable' : null)
  const gracefulFailureApplied = decision == null
  await trackTraceActivitySafely({
    activityType: 'trace.runtime.decision.response',
    summary: 'Runtime-Entscheidung abgeschlossen',
    conversationId,
    characterId,
    characterName,
    learningGoalIds: runtimeContext.learningGoalIds,
    traceStage: 'routing',
    traceKind: 'decision',
    traceSource: 'runtime',
    input: {
      lastUserText,
      assistantText: content,
      publicConversationHistory,
    },
    output: {
      skillId: decision?.skillId ?? null,
      reason: decision?.reason ?? null,
      selectedLearningGoalId: decision?.selectedLearningGoalId ?? null,
      openTopicHint: resolvedOpenTopicHint ?? null,
      relationshipsRequested,
      activitiesRequested,
      routingDecisionSource: runtimeIntentDecision.source,
      primaryDecision: runtimeIntentDecision.primaryDecision?.skillId ?? null,
      secondaryDecision: runtimeIntentDecision.secondaryDecision?.skillId ?? null,
      secondaryUsed: runtimeIntentDecision.secondaryUsed,
      primaryFailureReason: runtimeIntentDecision.primaryFailureReason,
      secondaryFailureReason: runtimeIntentDecision.secondaryFailureReason,
      decisionFailureReason,
      gracefulFailureApplied,
    },
    ok: true,
  })
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'N3',location:'characterRuntimeOrchestrator.ts:orchestrate:decision',message:'Intent-Entscheidung erstellt',data:{conversationId,lastUserText,assistantText:content,decisionSkillId:decision?.skillId ?? null,decisionReason:decision?.reason ?? null},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  if (!decision) {
    await appendConversationMessage({
      conversationId,
      role: 'assistant',
      content: RUNTIME_TEMPORARY_UNAVAILABLE_MESSAGE,
      eventType: 'runtime.intent.unavailable',
      metadata: {
        sourceEventType: input.eventType,
        decisionFailureReason,
      },
    })
    await trackTraceActivitySafely({
      activityType: 'trace.runtime.orchestration.response',
      summary: 'Runtime-Orchestrierung mit Graceful-Fail beendet',
      conversationId,
      characterId,
      characterName,
      learningGoalIds: runtimeContext.learningGoalIds,
      traceStage: 'egress',
      traceKind: 'response',
      traceSource: 'runtime',
      output: {
        skillId: null,
        reason: 'llm-intent-unavailable',
        gracefulFailureApplied: true,
        decisionFailureReason,
      },
      ok: false,
    })
    return
  }

  const playbook = getCharacterAgentSkillPlaybook(decision.skillId)
  await trackRuntimeActivitySafely({
    activityType: 'runtime.skill.routed',
    characterId,
    characterName,
    conversationId,
    learningGoalIds: runtimeContext.learningGoalIds,
    object: {
      type: 'skill',
      id: decision.skillId,
      name: playbook?.name ?? decision.skillId,
    },
    metadata: {
      summary: `${characterName} waehlt den Skill ${decision.skillId}`,
      skillId: decision.skillId,
      toolIds: playbook?.toolIds ?? [],
      reason: decision.reason,
      selectedLearningGoalId: selectedLearningGoalId ?? null,
      selectedLearningGoalName: selectedLearningGoalName ?? null,
      openTopicHint: resolvedOpenTopicHint ?? null,
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
    conversationId,
    decision,
    assistantText: content,
    lastUserText,
    eventType: input.eventType,
    characterId,
    characterName,
    characterContext,
    learningGoalIds: effectiveLearningGoalIds,
    relationshipContext,
  })
  await trackTraceActivitySafely({
    activityType: 'trace.runtime.orchestration.response',
    summary: 'Runtime-Orchestrierung abgeschlossen',
    conversationId,
    characterId,
    characterName,
    learningGoalIds: runtimeContext.learningGoalIds,
    traceStage: 'egress',
    traceKind: 'response',
    traceSource: 'runtime',
    output: {
      skillId: decision.skillId,
      reason: decision.reason,
      gracefulFailureApplied: false,
    },
    ok: true,
  })
  if (
    isSelfAssistantTurn &&
    (pendingSelfSceneDecision?.decision.skillId === 'create_scene' ||
      pendingSelfSceneDecision?.decision.skillId === 'plan-and-act')
  ) {
    pendingSelfAssistantSceneDecisions.delete(conversationId)
  }
  if (!resolvedOpenTopicHint) {
    pendingOpenTopicHints.delete(conversationId)
  }
  if (input.role === 'assistant') {
    markAssistantMessageProcessed(conversationId, input.messageId)
  }
}
