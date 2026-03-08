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
import { getConversationDetails } from './conversationStore.ts'
import {
  loadCharacterRuntimeProfile,
  loadLearningGoalRuntimeProfiles,
} from './runtimeContentStore.ts'
import {
  readActivitiesRuntimeTool,
  readRelatedObjectsRuntimeTool,
  readRelationshipsRuntimeTool,
} from './runtime/tools/runtimeToolRegistry.ts'
import {
  detectRuntimeIntent,
  detectRuntimeIntentModelDecision,
  isMemoryImageRequest,
  detectRuntimeToolExecutionIntent,
} from './runtime/router/intentRouter.ts'
import {
  executeRoutedSkill,
  scheduleMemoryImageRecallFromUserTurn,
} from './runtime/skills/skillExecutor.ts'
import { trackTraceActivitySafely } from './traceActivity.ts'

type OrchestrateCharacterRuntimeTurnInput = {
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  eventType?: string
}

const ASSISTANT_VISUAL_MARKER_RE = /ich\s+zeige\s+dir\s+jetzt|schau\s+mal/i

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
    const memoryRequest = isMemoryImageRequest(content)
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
  const lastUserText =
    [...details.messages].reverse().find((item) => item.role === 'user')?.content?.trim() ?? ''
  const activeLearningGoals = await loadLearningGoalRuntimeProfiles(runtimeContext.learningGoalIds ?? [])
  const runtimeIntentDecision = await detectRuntimeIntentModelDecision(lastUserText, content)
  const { relationshipsRequested, activitiesRequested } = runtimeIntentDecision.flags

  let relationshipCount = 0
  if (relationshipsRequested) {
    const runtimeToolContext = {
      characterId,
      characterName,
      conversationId,
      learningGoalIds: runtimeContext.learningGoalIds,
    }
    const relationshipResult = await readRelationshipsRuntimeTool().execute(runtimeToolContext, {})
    relationshipCount = relationshipResult.relationshipCount
    await readRelatedObjectsRuntimeTool().execute(runtimeToolContext, {
      relatedCharacterIds: relationshipResult.relatedCharacterIds,
      relationshipLinks: relationshipResult.relationshipLinks,
    })
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

  const detectedDecision = runtimeIntentDecision.decision ?? detectRuntimeIntent(lastUserText, content)
  const decision =
    detectedDecision ??
    (ASSISTANT_VISUAL_MARKER_RE.test(content)
      ? {
          skillId: 'do-something' as const,
          reason: 'degraded-visual-fallback',
        }
      : {
          skillId: 'remember-something' as const,
          reason: 'degraded-no-decision-fallback',
        })
  const degradedFallbackApplied = detectedDecision == null
  const toolExecutionIntent = detectRuntimeToolExecutionIntent(lastUserText)
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
      lastUserText: lastUserText.slice(0, 240),
      assistantText: content.slice(0, 240),
    },
    output: {
      skillId: decision?.skillId,
      reason: decision?.reason,
      preDegradedSkillId: detectedDecision?.skillId ?? null,
      preDegradedReason: detectedDecision?.reason ?? null,
      degradedFallbackApplied,
      toolExecutionTaskId: toolExecutionIntent?.taskId,
      relationshipsRequested,
      activitiesRequested,
      routingDecisionSource: runtimeIntentDecision.source,
    },
    ok: true,
  })
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'N3',location:'characterRuntimeOrchestrator.ts:orchestrate:decision',message:'Intent-Entscheidung erstellt',data:{conversationId,lastUserText,assistantText:content,decisionSkillId:decision?.skillId ?? null,decisionReason:decision?.reason ?? null},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
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
      toolExecutionTaskId: toolExecutionIntent?.taskId,
      toolExecutionDryRun: toolExecutionIntent?.dryRun,
      toolExecutionReason: toolExecutionIntent?.reason,
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
    learningGoalIds: runtimeContext.learningGoalIds,
    toolExecutionIntent,
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
    },
    ok: true,
  })
}
