import { listActivities } from '../../activityStore.ts'
import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import { trackTraceActivitySafely } from '../../traceActivity.ts'
import { readCanonicalStoryText } from '../../../storyText.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { trackRuntimeToolActivitySafely } from './runtimeToolActivityLogger.ts'

type ReadActivitiesToolInput = {
  limit?: number
  offset?: number
  scope?: 'external' | 'all'
  conversationId?: string
  fetchAll?: boolean
}

type ReadActivitiesToolOutput = {
  activityCount: number
  hasMore: boolean
  nextOffset: number
  items: Array<{
    activityId: string
    activityType: string
    isPublic: boolean
    conversationId?: string
    occurredAt: string
    createdAt: string
    objectType?: string
    objectId?: string
    imageRefs: {
      imageId?: string
      heroImageUrl?: string
      imageUrl?: string
      imageLinkUrl?: string
      imageAssetPath?: string
      originalImageUrl?: string
    }
    storySummary?: string
    summary?: string
    metadata: Record<string, unknown>
  }>
}

const DEFAULT_LIMIT = 200
const TECHNICAL_ACTIVITY_PREFIXES = ['trace.', 'tool.', 'skill.', 'runtime.']

const toScope = (value: ReadActivitiesToolInput['scope']): 'external' | 'all' =>
  value === 'all' ? 'all' : 'external'

const clampLimit = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(500, Math.floor(value)))
}

const clampOffset = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

const shouldFetchAll = (value: unknown): boolean => value === true

const readText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const extractImageId = (input: {
  imageAssetPath?: string
  imageUrl?: string
  heroImageUrl?: string
  imageLinkUrl?: string
}): string | undefined => {
  const fromAssetPath = readText(input.imageAssetPath)
  if (fromAssetPath) {
    const last = fromAssetPath.split('/').filter(Boolean).at(-1)
    return last?.replace(/\.[a-z0-9]+$/i, '') || undefined
  }
  const fromUrl = readText(input.imageUrl) ?? readText(input.heroImageUrl) ?? readText(input.imageLinkUrl)
  if (!fromUrl) return undefined
  const noQuery = fromUrl.split('?')[0]
  const last = noQuery.split('/').filter(Boolean).at(-1)
  return last?.replace(/\.[a-z0-9]+$/i, '') || undefined
}

const isTechnicalActivity = (activityType: unknown): boolean => {
  if (typeof activityType !== 'string') return false
  return TECHNICAL_ACTIVITY_PREFIXES.some((prefix) => activityType.startsWith(prefix))
}

export const readActivitiesTool: RuntimeToolHandler<
  ReadActivitiesToolInput,
  ReadActivitiesToolOutput
> = {
  id: CHARACTER_AGENT_TOOLS.readActivities,
  execute: async (context, input) => {
    await trackTraceActivitySafely({
      activityType: 'trace.tool.read_activities.request',
      summary: `${context.characterName} startet read_activities`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'request',
      traceSource: 'runtime',
      input,
    })
    const scope = toScope(input.scope)
    const limit = clampLimit(input.limit)
    const offset = clampOffset(input.offset)
    const conversationId = readText(input.conversationId)
    const fetchAll = shouldFetchAll(input.fetchAll)

    const queryBase = {
      characterId: context.characterId,
      conversationId,
      isPublic: scope === 'external' ? true : undefined,
    }

    const activities = fetchAll
      ? await (async () => {
          const allItems: Awaited<ReturnType<typeof listActivities>> = []
          let pageOffset = offset
          while (true) {
            const page = await listActivities({
              ...queryBase,
              limit,
              offset: pageOffset,
            })
            allItems.push(...page)
            if (page.length < limit) break
            pageOffset += page.length
          }
          return allItems
        })()
      : await listActivities({
          ...queryBase,
          limit,
          offset,
        })
    const scopedActivities =
      scope === 'external'
        ? activities.filter((activity) => !isTechnicalActivity(activity.activityType))
        : activities
    const items = scopedActivities.map((activity) => {
      const metadata = (activity.metadata ?? {}) as Record<string, unknown>
      const object = (activity.object ?? {}) as Record<string, unknown>
      const canonicalSummary = readCanonicalStoryText({
        activityType: activity.activityType,
        storySummary: activity.storySummary,
        metadata,
      })
      const heroImageUrl = readText(metadata.heroImageUrl)
      const imageUrl = readText(metadata.imageUrl)
      const imageLinkUrl = readText(metadata.imageLinkUrl)
      const imageAssetPath = readText(metadata.imageAssetPath)
      const originalImageUrl = readText(metadata.originalImageUrl)
      const imageId = extractImageId({
        imageAssetPath,
        imageUrl,
        heroImageUrl,
        imageLinkUrl,
      })
      return {
        activityId: activity.activityId,
        activityType: activity.activityType,
        isPublic: activity.isPublic,
        conversationId: activity.conversationId,
        occurredAt: activity.occurredAt,
        createdAt: activity.createdAt,
        objectType: readText(object.type),
        objectId: readText(object.id),
        imageRefs: {
          imageId,
          heroImageUrl,
          imageUrl,
          imageLinkUrl,
          imageAssetPath,
          originalImageUrl,
        },
        storySummary: canonicalSummary,
        summary: canonicalSummary,
        metadata,
      }
    })
    const activityCount = items.length
    const nextOffset = offset + items.length
    const hasMore = fetchAll ? false : activities.length >= limit

    await trackRuntimeToolActivitySafely({
      activityType: 'tool.activities.read',
      characterId: context.characterId,
      characterName: context.characterName,
      conversationId: context.conversationId,
      learningGoalIds: context.learningGoalIds,
      object: {
        type: 'activities',
        scope: 'runtime-routing',
      },
      metadata: {
        summary: `${context.characterName} schaut fuer die Runtime in letzte Activities`,
        toolId: CHARACTER_AGENT_TOOLS.readActivities,
        scope,
        activityCount,
        limit,
        offset,
        nextOffset,
        hasMore,
        fetchAll,
        stage: 'runtime-router',
      },
    })

    await trackTraceActivitySafely({
      activityType: 'trace.tool.read_activities.response',
      summary: `${context.characterName} beendet read_activities`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'response',
      traceSource: 'runtime',
      output: { activityCount, scope, limit, offset, nextOffset, hasMore, fetchAll },
      ok: true,
    })

    return {
      activityCount,
      hasMore,
      nextOffset,
      items,
    }
  },
}
