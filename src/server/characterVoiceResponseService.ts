import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  listRelationshipsForCharacter,
  type CharacterRelationshipRecord,
} from './relationshipStore.ts'
import { getConversationDetails, type ConversationDetailsRecord } from './conversationStore.ts'
import { resolveCounterpartName, toPublicConversationHistory } from './conversationActivityHelpers.ts'
import { getOpenAiApiKey, readServerEnv } from './openAiConfig.ts'
import * as gameObjectService from './gameObjectService.ts'
import { readThumbnailAsBase64 } from './conversationImageAssetStore.ts'
import { contextFromMetadata } from './conversationRuntimeContext.ts'
import { loadLearningGoalRuntimeProfiles } from './runtimeContentStore.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const MAX_REALTIME_CONTEXT_MESSAGES = 12
const VOICE_CHAT_MODEL = readServerEnv('VOICE_CHAT_MODEL', 'gpt-5.4')
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const ALLOWED_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar'] as const

type RelatedCharacterFact = {
  characterId: string
  name: string
  species: string
  shortDescription: string
  coreTraits: string[]
}

export type CharacterVoiceSessionContext = {
  characterId: string
  characterName: string
  voice: (typeof ALLOWED_VOICES)[number]
  fullInstructions: string
  promptInfo: {
    promptPath: string
    promptLength: number
  }
  lastSceneImage: {
    base64: string
    mimeType: string
    sceneSummary: string
  } | null
}

const loadCharacterYaml = async (characterId: string): Promise<Record<string, unknown>> => {
  const characterObject = await gameObjectService.get(characterId)
  if (!characterObject || characterObject.type !== 'character') {
    throw new Error(`Character not found: ${characterId}`)
  }
  const yamlPath = await gameObjectService.resolveYamlPathForGameObject(characterObject.id, 'character')
  if (!yamlPath) {
    throw new Error(`Character YAML not found: ${characterId}`)
  }
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

  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, RelatedCharacterFact] => entry !== null),
  )
}

const loadPromptTemplate = async (): Promise<{ path: string; text: string }> => {
  const promptPath = path.resolve(workspaceRoot, 'content/prompts/character-voice-agent.md')
  const text = await readFile(promptPath, 'utf8')
  return { path: promptPath, text }
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
  if (!relationships || typeof relationships !== 'object') return []
  const relationshipRecord = relationships as Record<string, unknown>
  const placeRelations = Array.isArray(relationshipRecord.places) ? relationshipRecord.places : []
  const lines: string[] = []
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
  return lines
}

const formatMetadata = (metadata: unknown): string => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return ''
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
  if (relationships.length === 0) return []
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

const uniqueNonEmpty = (values: string[]): string[] =>
  Array.from(new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)))

const normalizeInlineText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const isAllowedVoice = (value: string): value is (typeof ALLOWED_VOICES)[number] =>
  (ALLOWED_VOICES as readonly string[]).includes(value)

const resolveVoiceFromYaml = (yaml: Record<string, unknown>): (typeof ALLOWED_VOICES)[number] => {
  const configuredVoice = getString(yaml, 'voice')
  return isAllowedVoice(configuredVoice) ? configuredVoice : 'coral'
}

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
  if (temperament) lines.push(`- Dein Grundtempo und deine Satzmelodie passen zu diesem Temperament: ${temperament}.`)
  if (socialStyle) lines.push(`- Deine Naehe, Distanz und Offenheit im Gespraech folgen diesem Sozialstil: ${socialStyle}.`)
  if (roleArchetype) lines.push(`- Deine Haltung im Gespraech soll zu dieser Story-Rolle passen: ${roleArchetype}.`)
  if (strengths.length > 0) lines.push(`- Wenn du hilfst oder fuehrst, tue es auf eine Weise, die deine Staerken zeigt: ${strengths.join(', ')}.`)
  if (weaknesses.length > 0) lines.push(`- Kleine Reibungen duerfen aus deinen Schwaechen entstehen, ohne dass du das Gespraech blockierst: ${weaknesses.join(', ')}.`)
  if (quirks.length > 0) lines.push(`- Deine Eigenheiten duerfen in kleinen Dosen hoerbar werden: ${quirks.join(', ')}.`)
  lines.push('- Wenn du sprichst, sollen Wortwahl, Rhythmus, Pausen und emotionale Faerbung zu deiner Figur passen.')
  return lines.join('\n')
}

const buildVoiceProfileBlock = (yaml: Record<string, unknown>): string => {
  const voiceProfile = yaml.voice_profile as Record<string, unknown> | undefined
  if (!voiceProfile || typeof voiceProfile !== 'object') {
    return '- Kein voice_profile gefunden. Nutze einen klaren, warmen und kindgerechten Standardton.'
  }
  const lines = [
    getString(voiceProfile, 'identity') ? `- Identitaet: ${getString(voiceProfile, 'identity')}` : '',
    getString(voiceProfile, 'demeanor') ? `- Grundhaltung: ${getString(voiceProfile, 'demeanor')}` : '',
    getString(voiceProfile, 'tone') ? `- Tonfall: ${getString(voiceProfile, 'tone')}` : '',
    getString(voiceProfile, 'enthusiasm_level') ? `- Enthusiasmus: ${getString(voiceProfile, 'enthusiasm_level')}` : '',
    getString(voiceProfile, 'formality_level') ? `- Formalitaet: ${getString(voiceProfile, 'formality_level')}` : '',
    getString(voiceProfile, 'emotion_level') ? `- Emotionale Ausdrucksstaerke: ${getString(voiceProfile, 'emotion_level')}` : '',
    getString(voiceProfile, 'filler_words') ? `- Fuellwoerter: ${getString(voiceProfile, 'filler_words')}` : '',
    getString(voiceProfile, 'pacing') ? `- Sprechtempo und Rhythmus: ${getString(voiceProfile, 'pacing')}` : '',
  ].filter((line) => line.length > 0)
  if (lines.length === 0) {
    return '- Kein voice_profile gefunden. Nutze einen klaren, warmen und kindgerechten Standardton.'
  }
  return lines.join('\n')
}

export const resolveRealtimeVoiceFromCharacterYaml = resolveVoiceFromYaml
export const buildVoiceProfileInstructionsBlock = buildVoiceProfileBlock

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
    '{{voice_profile_block}}': buildVoiceProfileBlock(yaml),
    '{{visible_goal}}': getString(yaml, 'story_psychology', 'visible_goal'),
    '{{deeper_need}}': getString(yaml, 'story_psychology', 'deeper_need'),
    '{{fear}}': getString(yaml, 'story_psychology', 'fear'),
    '{{insecurity}}': getString(yaml, 'story_psychology', 'insecurity'),
    '{{stress_response}}': getString(yaml, 'story_psychology', 'stress_response'),
    '{{growth_direction}}': getString(yaml, 'story_psychology', 'growth_direction'),
    '{{relationships_block}}': buildRelationshipsBlock(yaml, dbRelationships, relatedFactsByCharacterId),
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
): Promise<CharacterVoiceSessionContext['lastSceneImage']> => {
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
  if (sceneSummary) lines.push(`Die Szenenbeschreibung: ${sceneSummary}`)
  return lines.join('\n')
}

const buildLearningGoalContextBlock = async (
  details: ConversationDetailsRecord | null,
): Promise<string> => {
  if (!details) return ''
  const runtimeContext = contextFromMetadata(details.conversation.metadata)
  const learningGoalIds = runtimeContext.learningGoalIds ?? []
  if (learningGoalIds.length === 0) return ''
  const profiles = await loadLearningGoalRuntimeProfiles(learningGoalIds)
  if (profiles.length === 0) return ''
  const lines = [
    '## Aktive Lernziele im Gespraech',
    'Nutze diese Ziele als sanfte Leitplanken fuer deine Gespraechsfuehrung.',
  ]
  for (const profile of profiles.slice(0, 3)) {
    const topicGroup = profile.topicGroup ? ` | Themenfeld: ${profile.topicGroup}` : ''
    const topic = profile.topic ? ` | Thema: ${profile.topic}` : ''
    const sessionGoal = profile.sessionGoal ? ` | Sitzungsziel: ${profile.sessionGoal}` : ''
    const practiceIdea =
      profile.practiceIdeas.length > 0
        ? ` | Praxisidee: ${profile.practiceIdeas[0]}`
        : ''
    lines.push(`- ${profile.name} (${profile.id})${topicGroup}${topic}${sessionGoal}${practiceIdea}`)
  }
  lines.push(
    '- Verbinde Antworten mit einer kleinen kindgerechten Handlung oder Entscheidung, damit das Ziel im Dialog sichtbar wird.',
  )
  return lines.join('\n')
}

export const buildCharacterVoiceSessionContext = async (input: {
  characterId: string
  conversationDetails: ConversationDetailsRecord | null
}): Promise<CharacterVoiceSessionContext> => {
  const characterObject = await gameObjectService.get(input.characterId)
  if (!characterObject || characterObject.type !== 'character') {
    throw new Error('Character nicht gefunden.')
  }
  const [yaml, templateData, dbRelationships] = await Promise.all([
    loadCharacterYaml(input.characterId),
    loadPromptTemplate(),
    listRelationshipsForCharacter(characterObject.id),
  ])
  const voice = resolveVoiceFromYaml(yaml)
  const relatedCharacterIds = dbRelationships.map((relationship) =>
    relationship.direction === 'outgoing'
      ? relationship.targetCharacterId
      : relationship.sourceCharacterId,
  )
  const relatedFactsByCharacterId = await loadRelatedCharacterFacts(relatedCharacterIds)
  const instructions = buildInstructions(templateData.text, yaml, dbRelationships, relatedFactsByCharacterId)
  const characterName = getString(yaml, 'name') || characterObject.name || input.characterId
  const conversationContextBlock = input.conversationDetails
    ? buildConversationContextBlock({
        details: input.conversationDetails,
        characterName,
      })
    : ''
  const learningGoalContextBlock = await buildLearningGoalContextBlock(input.conversationDetails)
  const lastSceneImage = await resolveLastSceneImage(input.conversationDetails)
  const instructionParts = [instructions]
  if (conversationContextBlock) instructionParts.push(conversationContextBlock)
  if (learningGoalContextBlock) instructionParts.push(learningGoalContextBlock)
  if (lastSceneImage) instructionParts.push(buildSceneImageContextBlock(lastSceneImage.sceneSummary))
  return {
    characterId: characterObject.id,
    characterName,
    voice,
    fullInstructions: instructionParts.join('\n\n'),
    promptInfo: {
      promptPath: templateData.path,
      promptLength: templateData.text.length,
    },
    lastSceneImage,
  }
}

export const generateCharacterVoiceAssistantText = async (input: {
  characterId: string
  conversationId: string
}): Promise<{ assistantText: string; context: CharacterVoiceSessionContext }> => {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) throw new Error('OPENAI_API_KEY fehlt. Bitte in .env setzen.')
  const details = await getConversationDetails(input.conversationId)
  const context = await buildCharacterVoiceSessionContext({
    characterId: input.characterId,
    conversationDetails: details,
  })
  const publicHistory = toPublicConversationHistory(details.messages)
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: context.fullInstructions },
    ...publicHistory.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ]
  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VOICE_CHAT_MODEL,
      messages,
      max_completion_tokens: 450,
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Character voice completion failed (${response.status}): ${body}`)
  }
  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const assistantText = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!assistantText) {
    throw new Error('Character voice completion lieferte keinen Text.')
  }
  return { assistantText, context }
}
