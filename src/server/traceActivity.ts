import { createActivity } from './activityStore.ts'

type TraceStage = 'ingress' | 'routing' | 'skill' | 'tool' | 'egress'
type TraceKind = 'request' | 'response' | 'decision' | 'error'
type TraceSource = 'runtime' | 'api' | 'realtime'

type TraceInput = {
  activityType: string
  summary: string
  conversationId?: string
  characterId?: string
  characterName?: string
  learningGoalIds?: string[]
  traceStage: TraceStage
  traceKind: TraceKind
  traceSource: TraceSource
  input?: unknown
  output?: unknown
  ok?: boolean
  error?: string
  object?: Record<string, unknown>
}

const MAX_TEXT_LENGTH = 12_000
const MAX_JSON_LENGTH = 120_000

const trimText = (value: string): string =>
  value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}...` : value

const normalizeUnknown = (value: unknown): unknown => {
  if (typeof value === 'string') return trimText(value)
  if (value == null) return value
  try {
    const encoded = JSON.stringify(value)
    if (!encoded) return value
    if (encoded.length <= MAX_JSON_LENGTH) return value
    return {
      truncated: true,
      preview: `${encoded.slice(0, MAX_JSON_LENGTH)}...`,
    }
  } catch {
    return String(value)
  }
}

export const trackTraceActivitySafely = async (input: TraceInput): Promise<void> => {
  try {
    const characterId = input.characterId?.trim() || undefined
    const characterName = input.characterName?.trim() || characterId
    await createActivity({
      activityType: input.activityType,
      isPublic: false,
      characterId,
      conversationId: input.conversationId?.trim() || undefined,
      learningGoalIds: input.learningGoalIds,
      subject: characterId
        ? {
            type: 'character',
            id: characterId,
            name: characterName,
          }
        : {
            type: 'runtime',
            id: 'trace',
            name: 'trace',
          },
      object: input.object ?? {
        type: 'trace',
        stage: input.traceStage,
        kind: input.traceKind,
      },
      metadata: {
        summary: trimText(input.summary),
        traceStage: input.traceStage,
        traceKind: input.traceKind,
        traceSource: input.traceSource,
        input: normalizeUnknown(input.input),
        output: normalizeUnknown(input.output),
        ok: input.ok,
        error: input.error ? trimText(input.error) : undefined,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Trace activity tracking failed: ${message}`)
  }
}
