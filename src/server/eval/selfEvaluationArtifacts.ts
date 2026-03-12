import type { ActivityRecord } from '../activityStore.ts'
import type { ConversationInspection } from '../debugConversationReadService.ts'
import type { SelfEvaluationScenarioId } from './selfEvaluationScenarios.ts'

type ImageEvidence = {
  imageUrl?: string
  heroImageUrl?: string
  imageAssetPath?: string
  source: 'activity' | 'message'
  sourceType: string
  summary?: string
}

const TECHNICAL_EVENT_PREFIXES = ['tool.', 'trace.', 'runtime.', 'skill.'] as const
const CANONICAL_IMAGE_SOURCE_PRIORITY = new Map<string, number>([
  ['activity:conversation.image.generated', 0],
  ['activity:conversation.image.recalled', 1],
  ['message:tool.image.generated', 2],
])

export type SelfEvaluationArtifacts = {
  scenarioIds: SelfEvaluationScenarioId[]
  conversationId: string
  characterId: string
  executionMode: 'cli' | 'http'
  assistantGenerationSource: string
  voicePromptPath: string
  voicePromptLength: number
  conversationHistoryText: string
  publicActivitiesText: string
  imageEvidenceText: string
  runtimeContextText: string
  evaluationFocusText: string
  images: ImageEvidence[]
  publicActivities: ActivityRecord[]
}

const toText = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const isTechnicalEventType = (eventType: unknown): boolean => {
  if (typeof eventType !== 'string') return false
  const normalized = eventType.trim()
  if (!normalized) return false
  return TECHNICAL_EVENT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

const readImageEvidenceFromRecord = (
  source: 'activity' | 'message',
  sourceType: string,
  metadata: Record<string, unknown> | undefined,
): ImageEvidence | null => {
  if (!metadata) return null
  const imageUrl = toText(metadata.imageUrl) || toText(metadata.imageLinkUrl)
  const heroImageUrl = toText(metadata.heroImageUrl)
  const imageAssetPath = toText(metadata.imageAssetPath)
  const summary = toText(metadata.summary) || toText(metadata.storySummary)
  if (!imageUrl && !heroImageUrl && !imageAssetPath) return null
  return {
    imageUrl: imageUrl || undefined,
    heroImageUrl: heroImageUrl || undefined,
    imageAssetPath: imageAssetPath || undefined,
    source,
    sourceType,
    summary: summary || undefined,
  }
}

const toConversationHistoryText = (inspection: ConversationInspection): string => {
  const publicNarrativeMessages = inspection.messages.filter((message) => !isTechnicalEventType(message.eventType))
  if (publicNarrativeMessages.length === 0) return '(keine Nachrichten)'
  return publicNarrativeMessages
    .map((message, index) => {
      const eventType = message.eventType ? ` [${message.eventType}]` : ''
      const content = message.content.replace(/\s+/g, ' ').trim()
      return `${index + 1}. ${message.role}${eventType}: ${content}`
    })
    .join('\n')
}

const toPublicActivitiesText = (activities: ActivityRecord[]): string => {
  const narrativeActivities = activities.filter((activity) => activity.activityType !== 'conversation.message.created')
  if (narrativeActivities.length === 0) return '(keine oeffentlichen Activities)'
  return narrativeActivities
    .map((activity, index) => {
      const summary =
        toText(activity.storySummary) ||
        toText(activity.metadata?.summary) ||
        toText(activity.metadata?.storySummary) ||
        '(ohne Summary)'
      return `${index + 1}. ${activity.activityType}: ${summary}`
    })
    .join('\n')
}

const collectImageEvidence = (inspection: ConversationInspection): ImageEvidence[] => {
  const candidates: Array<ImageEvidence & { priority: number; sequence: number }> = []

  let sequence = 0
  for (const activity of inspection.activities) {
    const evidence = readImageEvidenceFromRecord(
      'activity',
      activity.activityType,
      activity.metadata as Record<string, unknown> | undefined,
    )
    if (!evidence) continue
    const sourceKey = `${evidence.source}:${evidence.sourceType}`
    const priority = CANONICAL_IMAGE_SOURCE_PRIORITY.get(sourceKey) ?? 99
    candidates.push({ ...evidence, priority, sequence })
    sequence += 1
  }

  for (const message of inspection.messages) {
    const evidence = readImageEvidenceFromRecord(
      'message',
      message.eventType ?? 'message',
      message.metadata as Record<string, unknown> | undefined,
    )
    if (!evidence) continue
    const sourceKey = `${evidence.source}:${evidence.sourceType}`
    const priority = CANONICAL_IMAGE_SOURCE_PRIORITY.get(sourceKey) ?? 99
    candidates.push({ ...evidence, priority, sequence })
    sequence += 1
  }

  const dedupedByImageKey = new Map<string, ImageEvidence & { priority: number; sequence: number }>()
  for (const candidate of candidates) {
    const imageKey = candidate.imageUrl || candidate.heroImageUrl || candidate.imageAssetPath
    const dedupeKey = imageKey || `${candidate.source}:${candidate.sourceType}:${candidate.sequence}`
    const existing = dedupedByImageKey.get(dedupeKey)
    if (!existing) {
      dedupedByImageKey.set(dedupeKey, candidate)
      continue
    }
    if (candidate.priority < existing.priority) {
      dedupedByImageKey.set(dedupeKey, candidate)
      continue
    }
    if (candidate.priority === existing.priority && candidate.sequence < existing.sequence) {
      dedupedByImageKey.set(dedupeKey, candidate)
    }
  }

  return Array.from(dedupedByImageKey.values())
    .sort((a, b) => a.sequence - b.sequence)
    .map(({ priority: _priority, sequence: _sequence, ...evidence }) => evidence)
}

const toImageEvidenceText = (images: ImageEvidence[]): string => {
  if (images.length === 0) return '(keine Bildreferenzen gefunden)'
  return images
    .map((image, index) => {
      const url = image.imageUrl || image.heroImageUrl || '(ohne URL)'
      const asset = image.imageAssetPath ? ` | asset=${image.imageAssetPath}` : ''
      const summary = image.summary ? ` | summary=${image.summary}` : ''
      return `${index + 1}. ${image.source}/${image.sourceType}: ${url}${asset}${summary}`
    })
    .join('\n')
}

const toEvaluationFocusText = (inspection: ConversationInspection): string => {
  const metadata = (inspection.conversation.metadata ?? {}) as Record<string, unknown>
  const counterpartName = toText(metadata.counterpartName) || toText(metadata.userName) || 'Yoko'
  const counterpartCharacterId = toText(metadata.counterpartCharacterId)
  const learningGoalIds = Array.isArray(metadata.learningGoalIds)
    ? metadata.learningGoalIds
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : []
  const selfEvaluationScenarios = Array.isArray(metadata.selfEvaluationScenarios)
    ? metadata.selfEvaluationScenarios
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : []

  const lines = [
    `counterpartName: ${counterpartName}`,
    `counterpartCharacterId: ${counterpartCharacterId || '(nicht gesetzt)'}`,
    `conversationCharacterId: ${inspection.conversation.characterId}`,
    `activeLearningGoalIds: ${
      learningGoalIds.length > 0 ? learningGoalIds.join(', ') : '(keine aktiv gesetzt)'
    }`,
    `selfEvaluationScenariosFromMetadata: ${
      selfEvaluationScenarios.length > 0 ? selfEvaluationScenarios.join(', ') : '(keine)'
    }`,
    'WICHTIG: Beurteile explizit, ob die Gespraechsfuehrung fuer das Kind klar geleitet wird.',
  ]
  return lines.join('\n')
}

export const buildSelfEvaluationArtifacts = (input: {
  scenarioIds: SelfEvaluationScenarioId[]
  runtimeContextText: string
  executionMode: 'cli' | 'http'
  assistantGenerationSource: string
  voicePromptPath: string
  voicePromptLength: number
  inspection: ConversationInspection
}): SelfEvaluationArtifacts => {
  const publicActivities = input.inspection.activities.filter((activity) => activity.isPublic)
  const images = collectImageEvidence(input.inspection)
  return {
    scenarioIds: input.scenarioIds,
    conversationId: input.inspection.conversation.conversationId,
    characterId: input.inspection.conversation.characterId,
    executionMode: input.executionMode,
    assistantGenerationSource: input.assistantGenerationSource,
    voicePromptPath: input.voicePromptPath,
    voicePromptLength: input.voicePromptLength,
    conversationHistoryText: toConversationHistoryText(input.inspection),
    publicActivitiesText: toPublicActivitiesText(publicActivities),
    imageEvidenceText: toImageEvidenceText(images),
    runtimeContextText: input.runtimeContextText,
    evaluationFocusText: toEvaluationFocusText(input.inspection),
    images,
    publicActivities,
  }
}
