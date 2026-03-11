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
import { getConversationDetails, type ConversationDetailsRecord } from './conversationStore.ts'
import { resolveCounterpartName, toPublicConversationHistory } from './conversationActivityHelpers.ts'
import { getOpenAiApiKey } from './openAiConfig.ts'
import * as gameObjectService from './gameObjectService.ts'
import { readThumbnailAsBase64 } from './conversationImageAssetStore.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const MAX_REALTIME_CONTEXT_MESSAGES = 12
const REALTIME_VAD_SILENCE_DURATION_MS = 900

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
  const characterObject = await gameObjectService.get(characterId)
  if (!characterObject || characterObject.type !== 'character') {
    throw new Error(`Character not found: ${characterId}`)
  }
  const yamlPath = path.resolve(
    workspaceRoot,
    'content/characters',
    characterObject.slug,
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
        const characterObject = await gameObjectService.get(characterId)
        const yaml = await loadCharacterYaml(characterId)
        const fact: RelatedCharacterFact = {
          characterId: characterObject?.id ?? characterId,
          name: getString(yaml, 'name') || characterObject?.name || characterId,
          species: getString(yaml, 'basis', 'species'),
          shortDescription: getString(yaml, 'kurzbeschreibung'),
          coreTraits: getArray(yaml, 'persoenlichkeit', 'core_traits').filter(
            (item) => item.trim().length > 0,
          ),
        }
        return [characterObject?.id ?? characterId, fact] as const
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

const uniqueNonEmpty = (values: string[]): string[] => {
  return Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)))
}

const normalizeInlineText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const buildSpeechStyleBlock = (yaml: Record<string, unknown>): string => {
  const coreTraits = uniqueNonEmpty(getArray(yaml, 'persoenlichkeit', 'core_traits'))
  const strengths = uniqueNonEmpty(getArray(yaml, 'persoenlichkeit', 'strengths'))
  const weaknesses = uniqueNonEmpty(getArray(yaml, 'persoenlichkeit', 'weaknesses'))
  const quirks = uniqueNonEmpty(getArray(yaml, 'persoenlichkeit', 'quirks'))
  const temperament = getString(yaml, 'persoenlichkeit', 'temperament')
  const socialStyle = getString(yaml, 'persoenlichkeit', 'social_style')
  const roleArchetype = getString(yaml, 'basis', 'role_archetype')

  const lines: string[] = [
    '- Sprich nicht neutral oder austauschbar, sondern so, dass man dich an deiner Art sofort erkennt.',
  ]

  if (coreTraits.length > 0) {
    lines.push(`- Lass diese Kernzuege staendig in deiner Sprache mitschwingen: ${coreTraits.join(', ')}.`)
  }
  if (temperament) {
    lines.push(`- Dein Grundtempo und deine Satzmelodie passen zu diesem Temperament: ${temperament}.`)
  }
  if (socialStyle) {
    lines.push(`- Deine Naehe, Distanz und Offenheit im Gespraech folgen diesem Sozialstil: ${socialStyle}.`)
  }
  if (roleArchetype) {
    lines.push(`- Deine Haltung im Gespraech soll zu dieser Story-Rolle passen: ${roleArchetype}.`)
  }
  if (strengths.length > 0) {
    lines.push(`- Wenn du hilfst oder fuehrst, tue es auf eine Weise, die deine Staerken zeigt: ${strengths.join(', ')}.`)
  }
  if (weaknesses.length > 0) {
    lines.push(`- Kleine Reibungen duerfen aus deinen Schwaechen entstehen, ohne dass du das Gespraech blockierst: ${weaknesses.join(', ')}.`)
  }
  if (quirks.length > 0) {
    lines.push(`- Deine Eigenheiten duerfen in kleinen Dosen hoerbar werden: ${quirks.join(', ')}.`)
  }

  lines.push(
    '- Wenn du sprichst, sollen Wortwahl, Rhythmus, Pausen und emotionale Faerbung zu deiner Figur passen.',
  )

  return lines.join('\n')
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
    '{{speech_style_block}}': buildSpeechStyleBlock(yaml),
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

const buildConversationContextBlock = (input: {
  details: ConversationDetailsRecord
  characterName: string
}): string => {
  const counterpartName = resolveCounterpartName(input.details.conversation.metadata)
  const publicHistory = toPublicConversationHistory(input.details.messages)
    .slice(-MAX_REALTIME_CONTEXT_MESSAGES)
    .map((message) => {
      const speakerName = message.role === 'assistant' ? input.characterName : counterpartName
      return `- ${speakerName}: ${normalizeInlineText(message.content)}`
    })

  if (publicHistory.length === 0) return ''

  return [
    '## Laufender Gespraechskontext',
    `Wichtig: Das ist bereits ein laufendes Gespraech zwischen dir (${input.characterName}) und ${counterpartName}.`,
    '- Begruesse NICHT erneut.',
    '- Stelle dich NICHT erneut vor.',
    '- Antworte direkt auf den naechsten User-Turn und knuepfe an den Verlauf an.',
    '',
    'LETZTE OEFFENTLICHE NACHRICHTEN (aelteste zuerst):',
    ...publicHistory,
  ].join('\n')
}

type LastSceneImage = {
  base64: string
  mimeType: string
  sceneSummary: string
}

const findLastSceneImageUrl = (details: ConversationDetailsRecord): {
  imageUrl: string
  sceneSummary: string
} | null => {
  for (let i = details.messages.length - 1; i >= 0; i--) {
    const message = details.messages[i]
    if (message.role !== 'system') continue
    const metadata = (message.metadata ?? {}) as Record<string, unknown>
    const heroImageUrl = typeof metadata.heroImageUrl === 'string' ? metadata.heroImageUrl.trim() : ''
    const imageUrl = typeof metadata.imageUrl === 'string' ? metadata.imageUrl.trim() : ''
    const candidate = heroImageUrl || imageUrl
    if (!candidate) continue
    const sceneSummary = typeof metadata.sceneSummary === 'string' ? metadata.sceneSummary.trim() : ''
    return { imageUrl: candidate, sceneSummary }
  }
  return null
}

const resolveLastSceneImage = async (
  details: ConversationDetailsRecord | null,
): Promise<LastSceneImage | null> => {
  if (!details) return null
  const sceneRef = findLastSceneImageUrl(details)
  if (!sceneRef) return null
  const thumbnail = await readThumbnailAsBase64(sceneRef.imageUrl)
  if (!thumbnail) return null
  return {
    base64: thumbnail.base64,
    mimeType: thumbnail.mimeType,
    sceneSummary: sceneRef.sceneSummary,
  }
}

const buildSceneImageContextBlock = (sceneSummary: string): string => {
  const lines = [
    '## Aktuelles Szenenbild',
    'Dir wird gleich das aktuelle Szenenbild gezeigt. Beziehe dich darauf, wenn es zum Gespraech passt.',
  ]
  if (sceneSummary) {
    lines.push(`Die Szenenbeschreibung: ${sceneSummary}`)
  }
  return lines.join('\n')
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
      'Authorization': `Bearer ${getOpenAiApiKey()}`,
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
        silence_duration_ms: REALTIME_VAD_SILENCE_DURATION_MS,
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

      if (!getOpenAiApiKey()) {
        json(response, 400, {
          error: 'OPENAI_API_KEY fehlt. Bitte in .env setzen.',
        })
        return
      }

      const body = await readJsonBody(request)
      const characterId = typeof body.characterId === 'string' ? body.characterId.trim() : ''
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''

      if (!characterId) {
        json(response, 400, { error: 'characterId ist erforderlich.' })
        return
      }

      const voice = typeof body.voice === 'string' && ALLOWED_VOICES.includes(body.voice)
        ? body.voice
        : 'coral'

      const characterObject = await gameObjectService.get(characterId)
      if (!characterObject || characterObject.type !== 'character') {
        json(response, 404, { error: 'Character nicht gefunden.' })
        return
      }

      let conversationDetails: ConversationDetailsRecord | null = null
      if (conversationId) {
        conversationDetails = await getConversationDetails(conversationId)
        if (conversationDetails.conversation.characterId !== characterObject.id) {
          json(response, 400, {
            error: 'conversationId passt nicht zum angefragten Character.',
          })
          return
        }
      }

      const [yaml, template, dbRelationships] = await Promise.all([
        loadCharacterYaml(characterId),
        loadPromptTemplate(),
        listRelationshipsForCharacter(characterObject.id),
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
      const characterName = getString(yaml, 'name') || characterObject.name || characterId
      const conversationContextBlock = conversationDetails
        ? buildConversationContextBlock({
            details: conversationDetails,
            characterName,
          })
        : ''

      const lastSceneImage = await resolveLastSceneImage(conversationDetails)

      const instructionParts = [instructions]
      if (conversationContextBlock) instructionParts.push(conversationContextBlock)
      if (lastSceneImage) instructionParts.push(buildSceneImageContextBlock(lastSceneImage.sceneSummary))
      const fullInstructions = instructionParts.join('\n\n')

      const { token, expiresAt } = await createEphemeralToken(fullInstructions, voice)

      const sessionPayload: Record<string, unknown> = { token, expiresAt }
      if (lastSceneImage) {
        sessionPayload.lastSceneImage = {
          base64: lastSceneImage.base64,
          mimeType: lastSceneImage.mimeType,
          summary: lastSceneImage.sceneSummary,
        }
      }
      json(response, 200, sessionPayload)
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
