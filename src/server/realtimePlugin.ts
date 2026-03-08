import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { parse as parseYaml } from 'yaml'
import {
  listRelationshipsForCharacter,
  type CharacterRelationshipRecord,
} from './relationshipStore.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))

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

type RelatedCharacterFact = {
  characterId: string
  name: string
  species: string
  shortDescription: string
  coreTraits: string[]
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

const loadCharacterYaml = async (characterId: string): Promise<Record<string, unknown>> => {
  const yamlPath = path.resolve(
    workspaceRoot,
    'content/characters',
    characterId,
    'character.yaml',
  )
  const raw = await readFile(yamlPath, 'utf8')
  return parseYaml(raw) as Record<string, unknown>
}

const loadRelatedCharacterFacts = async (
  characterIds: string[],
): Promise<Record<string, RelatedCharacterFact>> => {
  const uniqueIds = Array.from(
    new Set(
      characterIds
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  )
  const entries = await Promise.all(
    uniqueIds.map(async (characterId) => {
      try {
        const yaml = await loadCharacterYaml(characterId)
        const fact: RelatedCharacterFact = {
          characterId,
          name: getString(yaml, 'name') || characterId,
          species: getString(yaml, 'basis', 'species'),
          shortDescription: getString(yaml, 'kurzbeschreibung'),
          coreTraits: getArray(yaml, 'persoenlichkeit', 'core_traits').filter(
            (item) => item.trim().length > 0,
          ),
        }
        return [characterId, fact] as const
      } catch {
        return null
      }
    }),
  )

  return Object.fromEntries(entries.filter((entry): entry is readonly [string, RelatedCharacterFact] => entry !== null))
}

const loadPromptTemplate = async (): Promise<string> => {
  const templatePath = path.resolve(
    workspaceRoot,
    'content/prompts/character-voice-agent.md',
  )
  return readFile(templatePath, 'utf8')
}

const getString = (obj: Record<string, unknown>, ...keys: string[]): string => {
  let current: unknown = obj
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current : ''
}

const getArray = (obj: Record<string, unknown>, ...keys: string[]): string[] => {
  let current: unknown = obj
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return []
    current = (current as Record<string, unknown>)[key]
  }
  return Array.isArray(current) ? current.map(String) : []
}

const buildPlaceRelationshipsFromYaml = (yaml: Record<string, unknown>): string[] => {
  const relationships = yaml.relationships
  if (!relationships || typeof relationships !== 'object') {
    return []
  }

  const relationshipRecord = relationships as Record<string, unknown>
  const placeRelations = Array.isArray(relationshipRecord.places) ? relationshipRecord.places : []

  const lines: string[] = []

  if (placeRelations.length > 0) {
    for (const relation of placeRelations) {
      if (!relation || typeof relation !== 'object') continue
      const relationRecord = relation as Record<string, unknown>
      const placeId = typeof relationRecord.place_id === 'string' ? relationRecord.place_id : ''
      const relationType = typeof relationRecord.typ === 'string' ? relationRecord.typ : ''
      const description =
        typeof relationRecord.beschreibung === 'string' ? relationRecord.beschreibung : ''

      if (!placeId && !relationType && !description) continue

      lines.push(
        `- ${placeId || 'unbekannt'} (${relationType || 'ohne Typ'})${
          description ? `: ${description}` : ''
        }`,
      )
    }
  }

  return lines
}

const formatMetadata = (metadata: unknown): string => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return ''
  }
  try {
    const encoded = JSON.stringify(metadata)
    return encoded && encoded !== '{}' ? ` [meta: ${encoded}]` : ''
  } catch {
    return ''
  }
}

const buildCharacterRelationshipsFromDb = (
  relationships: Array<CharacterRelationshipRecord & { direction: 'outgoing' | 'incoming' }>,
): string[] => {
  if (relationships.length === 0) {
    return []
  }

  return relationships.map((relationship) => {
    const counterpart =
      relationship.direction === 'outgoing'
        ? relationship.targetCharacterId
        : relationship.sourceCharacterId
    const directionLabel = relationship.direction === 'outgoing' ? 'ausgehend zu' : 'eingehend von'
    const label = relationship.relationship || relationship.relationshipType || 'ohne Typ'
    const description = relationship.description ? `: ${relationship.description}` : ''
    const metadata = formatMetadata(relationship.metadata)
    return `- ${directionLabel} ${counterpart} (${label})${description}${metadata}`
  })
}

const buildRelationshipsBlock = (
  yaml: Record<string, unknown>,
  dbRelationships: Array<CharacterRelationshipRecord & { direction: 'outgoing' | 'incoming' }>,
  relatedFactsByCharacterId: Record<string, RelatedCharacterFact>,
): string => {
  const lines: string[] = []
  const characterLines = buildCharacterRelationshipsFromDb(dbRelationships)
  const placeLines = buildPlaceRelationshipsFromYaml(yaml)
  const relatedFactsLines: string[] = []

  const relatedCharacterIds = Array.from(
    new Set(
      dbRelationships.map((relationship) =>
        relationship.direction === 'outgoing'
          ? relationship.targetCharacterId
          : relationship.sourceCharacterId,
      ),
    ),
  )
  for (const relatedCharacterId of relatedCharacterIds) {
    const fact = relatedFactsByCharacterId[relatedCharacterId]
    if (!fact) continue
    const speciesPart = fact.species ? ` (${fact.species})` : ''
    const traitPart =
      fact.coreTraits.length > 0 ? ` | Kernzuege: ${fact.coreTraits.slice(0, 3).join(', ')}` : ''
    const summaryPart = fact.shortDescription ? `: ${fact.shortDescription}` : ''
    relatedFactsLines.push(`- ${fact.name}${speciesPart}${summaryPart}${traitPart}`)
  }

  if (characterLines.length > 0) {
    lines.push('Beziehungen zu Figuren (aus Datenbank):')
    lines.push(...characterLines)
  }

  if (relatedFactsLines.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('Bekanntes ueber verknuepfte Figuren (Related Objects):')
    lines.push(...relatedFactsLines)
  }

  if (placeLines.length > 0) {
    if (lines.length > 0) lines.push('')
    lines.push('Beziehungen zu Orten (aus YAML):')
    lines.push(...placeLines)
  }

  return lines.length > 0 ? lines.join('\n') : 'Keine bekannten Beziehungen hinterlegt.'
}

const buildInstructions = (
  template: string,
  yaml: Record<string, unknown>,
  dbRelationships: Array<CharacterRelationshipRecord & { direction: 'outgoing' | 'incoming' }>,
  relatedFactsByCharacterId: Record<string, RelatedCharacterFact>,
): string => {
  const name = getString(yaml, 'name')
  const species = getString(yaml, 'basis', 'species')

  const vowelStart = /^[aeiouäöü]/i.test(species)
  const speciesArticle = vowelStart ? 'e' : ''

  const replacements: Record<string, string> = {
    '{{name}}': name,
    '{{species}}': species,
    '{{species_article}}': speciesArticle,
    '{{short_description}}': getString(yaml, 'kurzbeschreibung'),
    '{{age_hint}}': getString(yaml, 'basis', 'age_hint') || 'kindlich',
    '{{temperament}}': getString(yaml, 'persoenlichkeit', 'temperament'),
    '{{social_style}}': getString(yaml, 'persoenlichkeit', 'social_style'),
    '{{core_traits}}': getArray(yaml, 'persoenlichkeit', 'core_traits').join(', '),
    '{{strengths}}': getArray(yaml, 'persoenlichkeit', 'strengths').join(', '),
    '{{weaknesses}}': getArray(yaml, 'persoenlichkeit', 'weaknesses').join(', '),
    '{{quirks}}': getArray(yaml, 'persoenlichkeit', 'quirks').join(', ') || 'keine besonderen',
    '{{visible_goal}}': getString(yaml, 'story_psychology', 'visible_goal'),
    '{{deeper_need}}': getString(yaml, 'story_psychology', 'deeper_need'),
    '{{fear}}': getString(yaml, 'story_psychology', 'fear'),
    '{{insecurity}}': getString(yaml, 'story_psychology', 'insecurity'),
    '{{stress_response}}': getString(yaml, 'story_psychology', 'stress_response'),
    '{{growth_direction}}': getString(yaml, 'story_psychology', 'growth_direction'),
    '{{relationships_block}}': buildRelationshipsBlock(
      yaml,
      dbRelationships,
      relatedFactsByCharacterId,
    ),
  }

  const herkunft = yaml.herkunft as Record<string, unknown> | undefined
  if (herkunft) {
    const parts: string[] = []
    const geburtsort = getString(herkunft, 'geburtsort')
    if (geburtsort) parts.push(`- Geboren in: ${geburtsort}`)
    const aufgewachsen = getArray(herkunft, 'aufgewachsen_in')
    if (aufgewachsen.length) parts.push(`- Aufgewachsen in: ${aufgewachsen.join(', ')}`)
    const kultur = getArray(herkunft, 'kulturelle_praegung')
    if (kultur.length) parts.push(`- Kulturelle Praegung: ${kultur.join(', ')}`)
    const historie = getArray(herkunft, 'historische_praegung')
    if (historie.length) parts.push(`- Historische Praegung: ${historie.join(', ')}`)
    replacements['{{origin_block}}'] = parts.join('\n')
  } else {
    replacements['{{origin_block}}'] = 'Keine besonderen Herkunftsdetails bekannt.'
  }

  let result = template
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replaceAll(placeholder, value)
  }
  return result
}

const createEphemeralToken = async (
  instructions: string,
  voice: string,
): Promise<{ token: string; expiresAt: number }> => {
  const realtimeTools = [
    {
      type: 'function',
      name: 'unmute_user_microphone',
      description:
        'Entstummt das Mikrofon des Kindes nach deiner Antwort, damit es wieder sprechen kann.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ]
  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-realtime',
      voice,
      instructions,
      tools: realtimeTools,
      input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
      turn_detection: {
        type: 'server_vad',
        create_response: true,
        interrupt_response: false,
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI session creation failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as {
    client_secret: { value: string; expires_at: number }
  }
  return {
    token: data.client_secret.value,
    expiresAt: data.client_secret.expires_at,
  }
}

const ALLOWED_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']

const registerRealtimeApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/realtime', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')

      if (request.method !== 'POST' || requestUrl.pathname !== '/session') {
        next()
        return
      }

      if (!process.env.OPENAI_API_KEY) {
        json(response, 400, {
          error: 'OPENAI_API_KEY fehlt. Bitte in .env setzen.',
        })
        return
      }

      const body = await readJsonBody(request)
      const characterId = typeof body.characterId === 'string' ? body.characterId.trim() : ''

      if (!characterId) {
        json(response, 400, { error: 'characterId ist erforderlich.' })
        return
      }

      const voice = typeof body.voice === 'string' && ALLOWED_VOICES.includes(body.voice)
        ? body.voice
        : 'coral'

      const [yaml, template, dbRelationships] = await Promise.all([
        loadCharacterYaml(characterId),
        loadPromptTemplate(),
        listRelationshipsForCharacter(characterId),
      ])
      const relatedCharacterIds = dbRelationships.map((relationship) =>
        relationship.direction === 'outgoing'
          ? relationship.targetCharacterId
          : relationship.sourceCharacterId,
      )
      const relatedFactsByCharacterId = await loadRelatedCharacterFacts(relatedCharacterIds)

      const instructions = buildInstructions(
        template,
        yaml,
        dbRelationships,
        relatedFactsByCharacterId,
      )
      const { token, expiresAt } = await createEphemeralToken(instructions, voice)

      json(response, 200, { token, expiresAt })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = message.includes('ENOENT') ? 404 : 500
      json(response, status, { error: message })
    }
  })
}

export const realtimeApiPlugin = (): Plugin => ({
  name: 'storytime-realtime-api',
  configureServer(server) {
    registerRealtimeApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerRealtimeApi(server.middlewares)
  },
})
