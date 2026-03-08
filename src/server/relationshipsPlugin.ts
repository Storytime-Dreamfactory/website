import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  listAllRelationships,
  listRelationshipsForCharacter,
  upsertCharacterRelationship,
  type CharacterRelationshipMetadata,
} from './relationshipStore.ts'

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

const toMetadata = (value: unknown): CharacterRelationshipMetadata | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as CharacterRelationshipMetadata
}

const registerRelationshipsApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/relationships', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')
      const isRootPath = requestUrl.pathname === '/' || requestUrl.pathname === ''
      const isAllPath = requestUrl.pathname === '/all'

      if (request.method === 'GET' && isAllPath) {
        const relationships = await listAllRelationships()
        json(response, 200, { relationships })
        return
      }

      if (request.method === 'GET' && isRootPath) {
        const characterId = requestUrl.searchParams.get('characterId')?.trim() || ''
        if (!characterId) {
          json(response, 400, { error: 'characterId ist erforderlich.' })
          return
        }

        const relationships = await listRelationshipsForCharacter(characterId)
        json(response, 200, { relationships })
        return
      }

      if (request.method === 'POST' && isRootPath) {
        const body = await readJsonBody(request)

        const sourceCharacterId =
          typeof body.sourceCharacterId === 'string' ? body.sourceCharacterId : ''
        const targetCharacterId =
          typeof body.targetCharacterId === 'string' ? body.targetCharacterId : ''
        const relationshipType =
          typeof body.relationshipType === 'string' ? body.relationshipType : ''
        const relationshipTypeReadable =
          typeof body.relationshipTypeReadable === 'string' ? body.relationshipTypeReadable : undefined
        const relationship = typeof body.relationship === 'string' ? body.relationship : ''
        const description = typeof body.description === 'string' ? body.description : undefined
        const metadata = toMetadata(body.metadata)

        const storedRelationship = await upsertCharacterRelationship({
          sourceCharacterId,
          targetCharacterId,
          relationshipType,
          relationshipTypeReadable,
          relationship,
          description,
          metadata,
        })

        json(response, 201, { relationship: storedRelationship })
        return
      }

      next()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode = message.includes('erforderlich') ? 400 : 500
      json(response, statusCode, { error: message })
    }
  })
}

export const relationshipsApiPlugin = (): Plugin => ({
  name: 'storytime-relationships-api',
  configureServer(server) {
    registerRelationshipsApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerRelationshipsApi(server.middlewares)
  },
})
