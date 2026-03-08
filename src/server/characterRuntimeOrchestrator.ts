import { createActivity } from './activityStore.ts'
import {
  CHARACTER_AGENT_SKILL_PLAYBOOKS,
  getCharacterAgentSkillPlaybook,
} from './characterAgentDefinitions.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'
import { noteExplicitImageRequestFromUserMessage } from './conversationSceneImageService.ts'
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
  detectRuntimeIntentContextFlags,
  isMemoryImageRequest,
} from './runtime/router/intentRouter.ts'
import {
  executeRoutedSkill,
  scheduleMemoryImageRecallFromUserTurn,
} from './runtime/skills/skillExecutor.ts'

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

  if (input.role === 'user') {
    const memoryRequest = isMemoryImageRequest(content)
    // #region agent log
    fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'N2',location:'characterRuntimeOrchestrator.ts:orchestrate:user-turn',message:'User-Turn auf Memory-Request geprueft',data:{conversationId,memoryRequest,userText:content},timestamp:Date.now()})}).catch(()=>{})
    // #endregion
    noteExplicitImageRequestFromUserMessage({
      conversationId,
      userText: content,
    })
    if (memoryRequest) {
      void scheduleMemoryImageRecallFromUserTurn({
        conversationId,
        userText: content,
      })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`Memory image recall scheduling failed: ${message}`)
        })
    }
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
  const { relationshipsRequested, activitiesRequested } = detectRuntimeIntentContextFlags(lastUserText)

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

  const decision = detectRuntimeIntent(lastUserText, content)
  // #region agent log
  fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'N3',location:'characterRuntimeOrchestrator.ts:orchestrate:decision',message:'Intent-Entscheidung erstellt',data:{conversationId,lastUserText,assistantText:content,decisionSkillId:decision?.skillId ?? null,decisionReason:decision?.reason ?? null},timestamp:Date.now()})}).catch(()=>{})
  // #endregion
  if (!decision) return

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
  })
}
