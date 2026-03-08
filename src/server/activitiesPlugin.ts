import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { createActivity, listActivities, type ActivityData } from './activityStore.ts'

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

const registerActivitiesApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/activities', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')
      const isRootPath = requestUrl.pathname === '/' || requestUrl.pathname === ''

      if (request.method === 'GET' && isRootPath) {
        const includeNonPublic = toBoolean(requestUrl.searchParams.get('includeNonPublic')) === true
        const activities = await listActivities({
          isPublic: includeNonPublic ? undefined : true,
          characterId: requestUrl.searchParams.get('characterId') ?? undefined,
          placeId: requestUrl.searchParams.get('placeId') ?? undefined,
          skillId: requestUrl.searchParams.get('skillId') ?? undefined,
          conversationId: requestUrl.searchParams.get('conversationId') ?? undefined,
          activityType: requestUrl.searchParams.get('activityType') ?? undefined,
          limit: toNumber(requestUrl.searchParams.get('limit')),
          offset: toNumber(requestUrl.searchParams.get('offset')),
        })
        json(response, 200, { activities })
        return
      }

      if (request.method === 'POST' && isRootPath) {
        const body = await readJsonBody(request)
        const activityType = typeof body.activityType === 'string' ? body.activityType : ''
        const isPublic = typeof body.isPublic === 'boolean' ? body.isPublic : false
        const characterId = typeof body.characterId === 'string' ? body.characterId : undefined
        const placeId = typeof body.placeId === 'string' ? body.placeId : undefined
        const skillIds = toStringArray(body.skillIds)
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
          skillIds,
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
