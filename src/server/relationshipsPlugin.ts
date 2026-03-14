import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  type CharacterRelatedObject,
  RELATIONSHIP_TYPES,
  listAllRelationships,
  listRelationshipsByOtherRelatedObject,
  listRelationshipsForCharacter,
  upsertCharacterRelationship,
  type CharacterRelationshipMetadata,
} from './relationshipStore.ts'
import { parse as parseYaml } from 'yaml'
import * as gameObjectService from './gameObjectService.ts'
import type { Character } from '../content/types.ts'

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

const toProperties = (value: unknown): CharacterRelationshipMetadata | undefined => {
  if (!value) return undefined
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as CharacterRelationshipMetadata
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = parseYaml(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CharacterRelationshipMetadata
    }
    throw new Error('properties muss ein Objekt sein (JSON oder YAML).')
  }
  throw new Error('properties muss ein Objekt sein (JSON oder YAML).')
}

const toOtherRelatedObjects = (value: unknown): CharacterRelatedObject[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const parsed = value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      type: typeof item.type === 'string' ? item.type : '',
      id: typeof item.id === 'string' ? item.id : '',
      label: typeof item.label === 'string' ? item.label : undefined,
      metadata:
        item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
          ? (item.metadata as Record<string, unknown>)
          : undefined,
    }))
  return parsed
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

      if (request.method === 'GET' && requestUrl.pathname === '/types') {
        json(response, 200, { relationshipTypes: RELATIONSHIP_TYPES })
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

      if (request.method === 'GET' && requestUrl.pathname === '/by-object') {
        const type = requestUrl.searchParams.get('type')?.trim() || ''
        const id = requestUrl.searchParams.get('id')?.trim() || ''
        if (!type) {
          json(response, 400, { error: 'type ist erforderlich.' })
          return
        }
        if (!id) {
          json(response, 400, { error: 'id ist erforderlich.' })
          return
        }

        const matches = await listRelationshipsByOtherRelatedObject(type, id)
        json(response, 200, { type, id, matches })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/knowledge') {
        const characterId = requestUrl.searchParams.get('characterId')?.trim() || ''
        if (!characterId) {
          json(response, 400, { error: 'characterId ist erforderlich.' })
          return
        }

        const relationships = await listRelationshipsForCharacter(characterId)
        const relatedCharacterIds = Array.from(
          new Set(
            relationships.map((relationship) =>
              relationship.direction === 'outgoing'
                ? relationship.targetCharacterId
                : relationship.sourceCharacterId,
            ),
          ),
        ).filter((id) => id && id !== characterId)
        const relatedObjects = await Promise.all(
          relatedCharacterIds.map(async (relatedCharacterId) => {
            const relatedObject = await gameObjectService.get(relatedCharacterId)
            const character = relatedObject?.type === 'character' ? (relatedObject as Character) : null
            return {
              type: 'character',
              characterId: relatedCharacterId,
              name: character?.name ?? relatedCharacterId,
              species: character?.basis.species || undefined,
              shortDescription: character?.shortDescription || undefined,
              coreTraits: character?.personality.coreTraits ?? [],
            }
          }),
        )

        json(response, 200, {
          characterId,
          relationships,
          relatedObjects,
        })
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
        const fromTitle = typeof body.fromTitle === 'string' ? body.fromTitle : undefined
        const toTitle = typeof body.toTitle === 'string' ? body.toTitle : undefined
        const relationshipTypeReadable =
          typeof body.relationshipTypeReadable === 'string' ? body.relationshipTypeReadable : undefined
        const relationship = typeof body.relationship === 'string' ? body.relationship : ''
        const description = typeof body.description === 'string' ? body.description : undefined
        const properties = toProperties(body.properties ?? body.metadata)
        const otherRelatedObjects = toOtherRelatedObjects(body.otherRelatedObjects)

        const storedRelationship = await upsertCharacterRelationship({
          sourceCharacterId,
          targetCharacterId,
          relationshipType,
          fromTitle,
          toTitle,
          relationshipTypeReadable,
          relationship,
          description,
          properties,
          otherRelatedObjects,
        })

        json(response, 201, { relationship: storedRelationship })
        return
      }

      next()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode =
        message.includes('erforderlich') || message.includes('Unbekannter') || message.includes('muss ein Objekt')
          ? 400
          : 500
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
