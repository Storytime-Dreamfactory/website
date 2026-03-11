import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getActivityById,
  subscribeToActivityChanges,
  createActivity,
  type ActivityRecord,
} from './activityStore.ts'
import { inspectConversation } from './debugConversationReadService.ts'
import { getOpenAiApiKey, readServerEnv } from './openAiConfig.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const EVAL_MODEL = readServerEnv('EVAL_PROCESSOR_MODEL', 'gpt-5.4')

const PROMPT_FILE_MAP: Record<string, { path: string; label: string }> = {
  'intent-router': {
    path: 'content/prompts/runtime/intent-router-system.md',
    label: 'Intent-Router System-Prompt',
  },
  'scene-summary': {
    path: 'content/prompts/runtime/scene-summary-system.md',
    label: 'Scene-Summary Prompt',
  },
  'image-prompt': {
    path: 'content/prompts/runtime/image-prompt-system.md',
    label: 'Image-Prompt Prompt',
  },
  'character-voice': {
    path: 'content/prompts/character-voice-agent.md',
    label: 'Character Voice Agent Prompt',
  },
}

type EvalDiagnosis = {
  targetPromptId: string
  problem: string
  suggestion: string
}

const diagnoseFeedback = async (input: {
  feedbackText: string
  conversationTrace: string
}): Promise<EvalDiagnosis | null> => {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return null

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EVAL_MODEL,
      messages: [
        {
          role: 'system',
          content: [
            'Du bist ein Prompt-Engineer fuer Storytime. Analysiere das Nutzer-Feedback und den Conversation-Trace.',
            'Identifiziere welcher Prompt fuer das Problem verantwortlich ist.',
            '',
            'Verfuegbare Prompt-IDs:',
            '- intent-router: Steuert die Skill-Routing-Entscheidung (welcher Skill wird gewaehlt)',
            '- scene-summary: Erzeugt die Szenenbeschreibung fuer die naechste Bildszene',
            '- image-prompt: Erzeugt den Bildgenerierungs-Prompt aus der Szenenbeschreibung',
            '- character-voice: Steuert die Charakter-Stimme und das Gespraechsverhalten',
            '',
            'Gib ausschliesslich JSON zurueck mit: { "targetPromptId": "...", "problem": "...", "suggestion": "..." }',
            'targetPromptId muss eine der obigen IDs sein.',
            'problem: 1-2 Saetze was schiefgelaufen ist.',
            'suggestion: 1-2 Saetze was am Prompt geaendert werden sollte.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            feedbackText: input.feedbackText,
            conversationTrace: input.conversationTrace,
          }),
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
    }),
  })

  if (!response.ok) return null
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const raw = body.choices?.[0]?.message?.content
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const targetPromptId = typeof parsed.targetPromptId === 'string' ? parsed.targetPromptId : ''
    if (!PROMPT_FILE_MAP[targetPromptId]) return null
    return {
      targetPromptId,
      problem: typeof parsed.problem === 'string' ? parsed.problem : '',
      suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion : '',
    }
  } catch {
    return null
  }
}

const improvePrompt = async (input: {
  currentPrompt: string
  diagnosis: EvalDiagnosis
  feedbackText: string
}): Promise<string | null> => {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return null

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EVAL_MODEL,
      messages: [
        {
          role: 'system',
          content: [
            'Du bist ein Prompt-Engineer fuer Storytime.',
            'Verbessere den folgenden Prompt basierend auf der Diagnose und dem Nutzer-Feedback.',
            'Gib NUR den verbesserten Prompt-Text zurueck, ohne Erklaerungen oder Markdown-Wrapper.',
            'Behalte die bestehende Struktur bei und aendere nur das Noetige.',
            'Fuege keine neuen Abschnitte hinzu, die nicht zum Problem passen.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: JSON.stringify({
            currentPrompt: input.currentPrompt,
            problem: input.diagnosis.problem,
            suggestion: input.diagnosis.suggestion,
            originalFeedback: input.feedbackText,
          }),
        },
      ],
      max_tokens: 2000,
    }),
  })

  if (!response.ok) return null
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return body.choices?.[0]?.message?.content?.trim() ?? null
}

const buildTraceSnapshot = (activities: ActivityRecord[]): string => {
  const relevant = activities
    .filter((a) =>
      a.activityType.startsWith('trace.') ||
      a.activityType.startsWith('runtime.') ||
      a.activityType === 'conversation.scene.directed',
    )
    .slice(0, 20)

  return relevant
    .map((a) => {
      const meta = a.metadata ?? {}
      return `[${a.occurredAt}] ${a.activityType}: ${JSON.stringify(meta).slice(0, 500)}`
    })
    .join('\n')
}

const processEvalFeedback = async (activity: ActivityRecord): Promise<void> => {
  const feedbackText =
    (activity.metadata?.feedbackText as string) ??
    (activity.object as Record<string, unknown>)?.feedbackText as string ?? ''
  if (!feedbackText.trim()) return

  const conversationId = activity.conversationId
  if (!conversationId) return

  const inspection = await inspectConversation(conversationId)
  if (!inspection) return

  const traceSnapshot = buildTraceSnapshot(inspection.activities)

  const diagnosis = await diagnoseFeedback({
    feedbackText,
    conversationTrace: traceSnapshot,
  })
  if (!diagnosis) {
    await createActivity({
      activityType: 'eval.feedback.processed',
      isPublic: false,
      characterId: activity.characterId,
      conversationId,
      metadata: {
        originalFeedbackActivityId: activity.activityId,
        status: 'diagnosis-failed',
        feedbackText,
      },
    })
    return
  }

  const promptFile = PROMPT_FILE_MAP[diagnosis.targetPromptId]
  if (!promptFile) return

  const promptPath = path.resolve(workspaceRoot, promptFile.path)
  let currentPrompt: string
  try {
    currentPrompt = await readFile(promptPath, 'utf8')
  } catch {
    return
  }

  const improvedPrompt = await improvePrompt({
    currentPrompt,
    diagnosis,
    feedbackText,
  })
  if (!improvedPrompt || improvedPrompt === currentPrompt) {
    await createActivity({
      activityType: 'eval.feedback.processed',
      isPublic: false,
      characterId: activity.characterId,
      conversationId,
      metadata: {
        originalFeedbackActivityId: activity.activityId,
        status: 'no-change-needed',
        targetPromptId: diagnosis.targetPromptId,
        problem: diagnosis.problem,
        suggestion: diagnosis.suggestion,
        feedbackText,
      },
    })
    return
  }

  await writeFile(promptPath, improvedPrompt, 'utf8')

  await createActivity({
    activityType: 'eval.feedback.processed',
    isPublic: false,
    characterId: activity.characterId,
    conversationId,
    metadata: {
      originalFeedbackActivityId: activity.activityId,
      status: 'prompt-updated',
      targetPromptId: diagnosis.targetPromptId,
      targetPromptLabel: promptFile.label,
      targetPromptPath: promptFile.path,
      problem: diagnosis.problem,
      suggestion: diagnosis.suggestion,
      feedbackText,
      promptLengthBefore: currentPrompt.length,
      promptLengthAfter: improvedPrompt.length,
    },
  })

  console.log(
    `[eval-processor] Prompt updated: ${promptFile.path} (feedback: ${activity.activityId})`,
  )
}

let initialized = false

export const initEvalProcessor = async (): Promise<void> => {
  if (initialized) return
  initialized = true

  await subscribeToActivityChanges(async (event) => {
    if (event.event !== 'created') return
    try {
      const activity = await getActivityById(event.activityId)
      if (!activity || activity.activityType !== 'eval.feedback.submitted') return
      await processEvalFeedback(activity)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[eval-processor] Failed to process feedback: ${message}`)
    }
  })
}
