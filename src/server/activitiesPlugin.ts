import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  createActivity,
  getActivityById,
  listActivities,
  subscribeToActivityChanges,
  type ActivityData,
  type ActivityRecord,
} from './activityStore.ts'

type MiddlewareStack = {
  use: (
    route: string,
    handler: (
      request: IncomingMessage,
      response: ServerResponse,
      next: (error?: unknown) => void,
    ) => void | Promise<void>,
  ) => void
}

const json = (response: ServerResponse, statusCode: number, data: unknown): void => {
  if (response.headersSent) return
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(data))
}

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

const toObject = (value: unknown): ActivityData | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as ActivityData
}

const toStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === 'string')
}

const toNumber = (value: string | null): number | undefined => {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const toBoolean = (value: string | null): boolean | undefined => {
  if (value == null) return undefined
  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1') return true
  if (normalized === 'false' || normalized === '0') return false
  return undefined
}

const matchesFilter = (
  activity: ActivityRecord,
  filter: {
    isPublic?: boolean
    characterId?: string
    placeId?: string
    learningGoalId?: string
    conversationId?: string
    activityType?: string
    summaryOnly?: boolean
  },
): boolean => {
  if (typeof filter.isPublic === 'boolean' && activity.isPublic !== filter.isPublic) return false
  if (filter.characterId && activity.characterId !== filter.characterId) return false
  if (filter.placeId && activity.placeId !== filter.placeId) return false
  if (filter.conversationId && activity.conversationId !== filter.conversationId) return false
  if (filter.activityType && activity.activityType !== filter.activityType) return false
  if (filter.learningGoalId && !activity.learningGoalIds.includes(filter.learningGoalId)) return false
  if (filter.summaryOnly && !(activity.storySummary && activity.storySummary.trim().length > 0)) return false
  return true
}

const registerActivitiesApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/activities', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')
      const isRootPath = requestUrl.pathname === '/' || requestUrl.pathname === ''

      if (request.method === 'GET' && isRootPath) {
        const includeNonPublic = toBoolean(requestUrl.searchParams.get('includeNonPublic')) === true
        const learningGoalId =
          requestUrl.searchParams.get('learningGoalId') ??
          requestUrl.searchParams.get('learning_goal_id') ??
          requestUrl.searchParams.get('skillId')
        const summaryOnly = toBoolean(requestUrl.searchParams.get('summaryOnly')) === true
        const activities = await listActivities({
          isPublic: includeNonPublic ? undefined : true,
          characterId: requestUrl.searchParams.get('characterId') ?? undefined,
          placeId: requestUrl.searchParams.get('placeId') ?? undefined,
          learningGoalId: learningGoalId ?? undefined,
          conversationId: requestUrl.searchParams.get('conversationId') ?? undefined,
          activityType: requestUrl.searchParams.get('activityType') ?? undefined,
          limit: toNumber(requestUrl.searchParams.get('limit')),
          offset: toNumber(requestUrl.searchParams.get('offset')),
        })
        const filteredActivities = summaryOnly
          ? activities.filter((activity) => matchesFilter(activity, { summaryOnly: true }))
          : activities
        json(response, 200, { activities: filteredActivities })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/stream') {
        const includeNonPublic = toBoolean(requestUrl.searchParams.get('includeNonPublic')) === true
        const learningGoalId =
          requestUrl.searchParams.get('learningGoalId') ??
          requestUrl.searchParams.get('learning_goal_id') ??
          requestUrl.searchParams.get('skillId')
        const summaryOnly = toBoolean(requestUrl.searchParams.get('summaryOnly')) === true
        const filter = {
          isPublic: includeNonPublic ? undefined : true,
          characterId: requestUrl.searchParams.get('characterId') ?? undefined,
          placeId: requestUrl.searchParams.get('placeId') ?? undefined,
          learningGoalId: learningGoalId ?? undefined,
          conversationId: requestUrl.searchParams.get('conversationId') ?? undefined,
          activityType: requestUrl.searchParams.get('activityType') ?? undefined,
          summaryOnly,
        }

        response.statusCode = 200
        response.setHeader('Content-Type', 'text/event-stream')
        response.setHeader('Cache-Control', 'no-cache, no-transform')
        response.setHeader('Connection', 'keep-alive')
        response.write('retry: 3000\n')
        response.write('event: ready\n')
        response.write('data: {"status":"connected"}\n\n')

        const heartbeat = setInterval(() => {
          response.write(': keepalive\n\n')
        }, 25_000)

        const unsubscribe = await subscribeToActivityChanges((changeEvent) => {
          void (async () => {
            const activity = await getActivityById(changeEvent.activityId)
            if (!activity) return
            if (!matchesFilter(activity, filter)) return
            response.write('event: activity.created\n')
            response.write(`data: ${JSON.stringify(activity)}\n\n`)
          })()
        })

        request.on('close', () => {
          clearInterval(heartbeat)
          unsubscribe()
          response.end()
        })
        return
      }

      if (request.method === 'POST' && isRootPath) {
        const body = await readJsonBody(request)
        const activityType = typeof body.activityType === 'string' ? body.activityType : ''
        const isPublic = typeof body.isPublic === 'boolean' ? body.isPublic : false
        const characterId = typeof body.characterId === 'string' ? body.characterId : undefined
        const placeId = typeof body.placeId === 'string' ? body.placeId : undefined
        const learningGoalIds =
          toStringArray(body.learningGoalIds) ??
          toStringArray(body.learning_goal_ids) ??
          toStringArray(body.skillIds)
        const conversationId =
          typeof body.conversationId === 'string' ? body.conversationId : undefined
        const subject = toObject(body.subject)
        const object = toObject(body.object)
        const metadata = toObject(body.metadata)
        const occurredAt = typeof body.occurredAt === 'string' ? body.occurredAt : undefined

        const activity = await createActivity({
          activityType,
          isPublic,
          characterId,
          placeId,
          learningGoalIds,
          conversationId,
          subject,
          object,
          metadata,
          occurredAt,
        })

        json(response, 201, { activity })
        return
      }

      next()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (response.headersSent) {
        console.warn(`activities api failed after headers sent: ${message}`)
        try {
          response.end()
        } catch {
          // no-op
        }
        return
      }
      const statusCode = message.includes('erforderlich') || message.includes('gueltiges') ? 400 : 500
      json(response, statusCode, { error: message })
    }
  })
}

export const activitiesApiPlugin = (): Plugin => ({
  name: 'storytime-activities-api',
  configureServer(server) {
    registerActivitiesApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerActivitiesApi(server.middlewares)
  },
})
