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
import { RUNTIME_TEMPORARY_UNAVAILABLE_MESSAGE } from './openAiConfig.ts'
import {
  loadCharacterRuntimeProfile,
  loadLearningGoalRuntimeProfiles,
} from './runtimeContentStore.ts'
import {
  readActivitiesRuntimeTool,
  readRelatedObjectsRuntimeTool,
  readRelationshipsRuntimeTool,
} from './runtime/tools/runtimeToolRegistry.ts'
import { detectRuntimeIntentModelDecision } from './runtime/router/intentRouter.ts'
import {
  executeRoutedSkill,
  scheduleMemoryImageRecallFromUserTurn,
} from './runtime/skills/skillExecutor.ts'
import { trackTraceActivitySafely } from './traceActivity.ts'
import type { SceneCharacterContext, SceneRelationshipContext } from './runtime/skills/createSceneBuilder.ts'
import type {
  RuntimeIntentModelDecision,
  RuntimeIntentPublicMessage,
} from './runtime/router/intentRouter.ts'

type OrchestrateCharacterRuntimeTurnInput = {
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  eventType?: string
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
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'N1',location:'characterRuntimeOrchestrator.ts:orchestrate:start',message:'Runtime-Orchestrierung gestartet',data:{conversationId,role:input.role,eventType:input.eventType ?? null,contentPreview:content.slice(0,120)},timestamp:Date.now()})}).catch(()=>{})
  // #endregion

  let publicConversationHistory: RuntimeIntentPublicMessage[] = []
  try {
    const details = await getConversationDetails(conversationId)
    publicConversationHistory = toPublicConversationHistory(details.messages)

    if (input.role === 'assistant') {
      const precedingMessage = details.messages
        .filter((m) => m.content?.trim() !== content)
        .at(-1)
      const isResponseToGeneratedImage =
        precedingMessage?.role === 'system' &&
        (precedingMessage?.eventType === 'tool.image.generated' ||
          precedingMessage?.eventType === 'tool.image.recalled')
      if (isResponseToGeneratedImage) {
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
        secondaryUsed: userTurnDecision.secondaryUsed,
        primaryDecision: userTurnDecision.primaryDecision?.skillId ?? null,
        secondaryDecision: userTurnDecision.secondaryDecision?.skillId ?? null,
        primaryFailureReason: userTurnDecision.primaryFailureReason,
        secondaryFailureReason: userTurnDecision.secondaryFailureReason,
      },
      ok: true,
    })
    return
  }

  const details = await getConversationDetails(conversationId)
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
  publicConversationHistory = toPublicConversationHistory(details.messages)
  const activeLearningGoals = await loadLearningGoalRuntimeProfiles(runtimeContext.learningGoalIds ?? [])
  const runtimeIntentDecision = await detectRuntimeIntentModelDecision(
    lastUserText,
    content,
    publicConversationHistory,
  )
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

  let recentActivityCount = 0
  if (activitiesRequested) {
    const runtimeToolContext = {
      characterId,
      characterName,
      conversationId,
      learningGoalIds: runtimeContext.learningGoalIds,
    }
    const activityResult = await readActivitiesRuntimeTool().execute(runtimeToolContext, { limit: 12 })
    recentActivityCount = activityResult.activityCount
  }

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
      activeLearningGoalIds: activeLearningGoals.map((item) => item.id),
      activeLearningGoalNames: activeLearningGoals.map((item) => item.name),
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
    learningGoalIds: runtimeContext.learningGoalIds,
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
}
