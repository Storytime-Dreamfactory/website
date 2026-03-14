import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CollatedImageRef, CollatedRelatedObject } from '../context/contextCollationService.ts'
import { getOpenAiApiKey, readServerEnv } from '../../openAiConfig.ts'
import { readCanonicalStoryText } from '../../../storyText.ts'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const NEXT_SCENE_SUMMARY_MODEL = readServerEnv('RUNTIME_NEXT_SCENE_SUMMARY_MODEL', 'gpt-5.4')
const IMAGE_PROMPT_MODEL = readServerEnv('RUNTIME_IMAGE_PROMPT_MODEL', NEXT_SCENE_SUMMARY_MODEL)
const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const FETCH_ERROR_MESSAGE_MAX_LENGTH = 160

const readCauseCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined
  if (!cause || typeof cause !== 'object') return undefined
  const code = 'code' in cause ? (cause as { code?: unknown }).code : undefined
  return typeof code === 'string' && code.trim().length > 0 ? code.trim() : undefined
}

const classifyFetchFailure = (code: string | undefined, message: string): string => {
  const normalizedCode = (code ?? '').toUpperCase()
  const normalizedMessage = message.toLowerCase()
  if (
    normalizedCode === 'ENOTFOUND' ||
    normalizedCode === 'EAI_AGAIN' ||
    normalizedMessage.includes('getaddrinfo')
  ) {
    return 'dns'
  }
  if (
    normalizedCode === 'ETIMEDOUT' ||
    normalizedCode === 'ABORT_ERR' ||
    normalizedCode.includes('TIMEOUT') ||
    normalizedMessage.includes('timed out')
  ) {
    return 'timeout'
  }
  if (
    normalizedCode.includes('CERT') ||
    normalizedCode.includes('TLS') ||
    normalizedMessage.includes('certificate') ||
    normalizedMessage.includes('tls')
  ) {
    return 'tls'
  }
  if (
    normalizedCode === 'ECONNRESET' ||
    normalizedCode === 'ECONNREFUSED' ||
    normalizedCode === 'EHOSTUNREACH' ||
    normalizedCode === 'ENETUNREACH'
  ) {
    return 'network'
  }
  return 'unknown'
}

const compactFetchErrorMessage = (prefix: string, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  const code = readCauseCode(error)
  const reason = classifyFetchFailure(code, message)
  const compactMessage =
    message.length > FETCH_ERROR_MESSAGE_MAX_LENGTH
      ? `${message.slice(0, FETCH_ERROR_MESSAGE_MAX_LENGTH)}...`
      : message
  const parts = [
    prefix,
    'fetch-failed',
    `reason=${reason}`,
    code ? `code=${code}` : '',
    `message=${compactMessage}`,
  ].filter((item) => item.length > 0)
  return parts.join(':')
}

let cachedSceneSummaryPrompt: string | null = null
const loadSceneSummaryPrompt = async (): Promise<string> => {
  if (cachedSceneSummaryPrompt) return cachedSceneSummaryPrompt
  const promptPath = path.resolve(workspaceRoot, 'content/prompts/runtime/scene-summary-system.md')
  cachedSceneSummaryPrompt = await readFile(promptPath, 'utf8')
  return cachedSceneSummaryPrompt
}

let cachedImagePromptPrompt: string | null = null
const loadImagePromptPrompt = async (): Promise<string> => {
  if (cachedImagePromptPrompt) return cachedImagePromptPrompt
  const promptPath = path.resolve(workspaceRoot, 'content/prompts/runtime/image-prompt-system.md')
  cachedImagePromptPrompt = await readFile(promptPath, 'utf8')
  return cachedImagePromptPrompt
}

const STORYBOOK_ACTIVITY_TYPES = new Set(['conversation.image.generated', 'conversation.image.recalled'])

type StoryActivityInput = {
  activityType: string
  occurredAt: string
  createdAt: string
  conversationId?: string
  imageRefs: {
    imageId?: string
    imageUrl?: string
    heroImageUrl?: string
  }
  storySummary?: string
  summary?: string
  metadata?: Record<string, unknown>
}

export type SceneRelationshipLink = {
  relatedCharacterId: string
  direction: 'outgoing' | 'incoming'
  relationshipType: string
  relationshipTypeReadable: string
  relationship: string
  description?: string
  metadata?: Record<string, unknown>
  otherRelatedObjects?: Array<{
    type: string
    id: string
    label?: string
  }>
}

export type StorySummaryEntry = {
  timestamp: string
  summary: string
}

export type PublicActivitySummaryEntry = {
  timestamp: string
  activityType: string
  summary: string
}

export type StorySceneSnapshot = {
  timestamp: string
  summary: string
  imageUrl?: string
  imageId?: string
  conversationId?: string
}

export type StoryHistoryContext = {
  allSummaries: StorySummaryEntry[]
  whatHappenedSoFar: StorySummaryEntry[]
  previousScene: StorySceneSnapshot | null
  latestScene: StorySceneSnapshot | null
}

export type SceneBuildResult = {
  sceneSummary: string
  imagePrompt: string
}

export type GroundedSceneCharacter = {
  characterId: string
  displayName: string
  source: 'active-character' | 'relationship-name-match' | 'relationship-role-match' | 'object-context'
  evidence: string[]
  standardImagePath?: string
}

export type SceneRelationshipContext = {
  relationshipLinks: SceneRelationshipLink[]
  directRelatedObjects: CollatedRelatedObject[]
  contextualRelatedObjects?: Array<CollatedRelatedObject & { evidence?: string[] }>
}

type CharacterGroundingCandidate = {
  characterId: string
  displayName: string
  imageRefs: CollatedImageRef[]
  source: GroundedSceneCharacter['source']
  evidence: string[]
  relationshipLinks?: Array<{
    relationshipType: string
    relationshipTypeReadable: string
    relationship: string
  }>
}

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const normalizeText = (value: string): string =>
  normalizeWhitespace(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const includesExactTerm = (haystack: string, needle: string): boolean => {
  const normalizedNeedle = normalizeText(needle)
  if (!normalizedNeedle) return false
  return new RegExp(`(^|[^a-z0-9])${escapeRegex(normalizedNeedle)}([^a-z0-9]|$)`, 'i').test(haystack)
}

const matchesRelationshipRoleReference = (input: {
  haystack: string
  relationshipLinks: Array<{
    relationshipType: string
    relationshipTypeReadable: string
    relationship: string
  }>
}): boolean => {
  const relationshipTerms = input.relationshipLinks
    .flatMap((link) => [link.relationshipTypeReadable, link.relationshipType, link.relationship])
    .map((entry) => normalizeText(entry))
    .filter((entry) => entry.length > 0)
  if (relationshipTerms.length === 0) return false

  const matchesFearRole = relationshipTerms.some(
    (entry) => entry.includes('angst') || entry.includes('furcht') || entry.includes('fuercht'),
  )
  if (matchesFearRole) {
    return (
      input.haystack.includes('angst vor dir') ||
      input.haystack.includes('vor dir angst hat') ||
      input.haystack.includes('dich fuerchtet') ||
      input.haystack.includes('dich furchtet') ||
      input.haystack.includes('der angst vor dir hat') ||
      input.haystack.includes('die angst vor dir hat')
    )
  }

  const matchesFriendRole = relationshipTerms.some((entry) => entry.includes('freund'))
  if (matchesFriendRole) {
    return (
      input.haystack.includes('dein freund') ||
      input.haystack.includes('deine freundin') ||
      input.haystack.includes('mit dir befreundet')
    )
  }

  return false
}

export const readNarrativeSummary = (item: {
  activityType?: string
  storySummary?: string
  summary?: string
  metadata?: Record<string, unknown>
}): string | undefined => {
  return readCanonicalStoryText({
    activityType: item.activityType,
    storySummary: item.storySummary,
    metadata: item.metadata,
    fallbackSummary: item.summary,
  })
}

const toChronologyEntry = (activity: StoryActivityInput): StorySceneSnapshot | null => {
  if (!STORYBOOK_ACTIVITY_TYPES.has(activity.activityType)) return null
  const summary = readNarrativeSummary(activity)
  if (!summary) return null
  return {
    timestamp: activity.occurredAt || activity.createdAt,
    summary,
    imageUrl: readText(activity.imageRefs.imageUrl) || readText(activity.imageRefs.heroImageUrl) || undefined,
    imageId: readText(activity.imageRefs.imageId) || undefined,
    conversationId: readText(activity.conversationId) || undefined,
  }
}

const storyTimestampValue = (value: { timestamp: string }): number => {
  const parsed = new Date(value.timestamp)
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

export const buildStoryHistoryContext = (activities: StoryActivityInput[]): StoryHistoryContext => {
  const chronology = activities
    .map((activity) => toChronologyEntry(activity))
    .filter((item): item is StorySceneSnapshot => item !== null)
    .sort((a, b) => storyTimestampValue(a) - storyTimestampValue(b))

  const allSummaries = chronology.map((item) => ({
    timestamp: item.timestamp,
    summary: item.summary,
  }))
  const previousScene = chronology.length >= 2 ? chronology[chronology.length - 2] : null
  const latestScene = chronology.length >= 1 ? chronology[chronology.length - 1] : null
  const whatHappenedSoFar = chronology.slice(0, Math.max(0, chronology.length - 2)).map((item) => ({
    timestamp: item.timestamp,
    summary: item.summary,
  }))

  return {
    allSummaries,
    whatHappenedSoFar,
    previousScene,
    latestScene,
  }
}

const formatPromptTimestamp = (value: string): string => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
}

const formatHistoryEntries = (entries: StorySummaryEntry[]): string =>
  entries.length > 0
    ? entries.map((entry) => `- [${formatPromptTimestamp(entry.timestamp)}] ${entry.summary}`).join('\n')
    : '- Die Geschichte beginnt gerade erst.'

export const buildPublicActivityStream = (activities: StoryActivityInput[]): PublicActivitySummaryEntry[] =>
  activities
    .map((activity) => {
      const summary = readNarrativeSummary(activity)
      if (!summary) return null
      return {
        timestamp: activity.occurredAt || activity.createdAt,
        activityType: activity.activityType,
        summary,
      }
    })
    .filter((item): item is PublicActivitySummaryEntry => item !== null)
    .sort((a, b) => storyTimestampValue(a) - storyTimestampValue(b))

const formatPublicActivityEntries = (entries: PublicActivitySummaryEntry[]): string =>
  entries.length > 0
    ? entries
        .map(
          (entry) => `- [${formatPromptTimestamp(entry.timestamp)}] (${entry.activityType}) ${entry.summary}`,
        )
        .join('\n')
    : '- Noch keine oeffentlichen Activities vorhanden.'

const formatSceneSnapshot = (label: string, snapshot: StorySceneSnapshot | null): string[] => {
  if (!snapshot) {
    return [label, '- Keine fruehere Szene vorhanden.']
  }

  return [
    label,
    `- Zeitpunkt: ${formatPromptTimestamp(snapshot.timestamp)}`,
    `- Summary: ${snapshot.summary}`,
    snapshot.imageUrl ? `- Bildpfad: ${snapshot.imageUrl}` : '- Bildpfad: kein Bildpfad gespeichert',
  ]
}

export type SceneCharacterContext = {
  name: string
  species: string
  shortDescription: string
  coreTraits: string[]
  temperament: string
  socialStyle: string
  quirks: string[]
  strengths: string[]
  weaknesses: string[]
  visibleGoal: string
  fear: string
}

export type SceneLearningGoalContext = {
  id: string
  name: string
  topicGroup: string
  topic: string
  sessionGoal: string
  endState: string
  coreIdeas: string[]
  assessmentTargets: string[]
}

const formatCharacterContextText = (context: SceneCharacterContext | undefined): string => {
  if (!context) return ''
  const lines = [`CHARACTER CONTEXT (${context.name}):`]
  if (context.species) lines.push(`- Spezies: ${context.species}`)
  if (context.shortDescription) lines.push(`- Beschreibung: ${context.shortDescription}`)
  if (context.coreTraits.length > 0) lines.push(`- Kernzuege: ${context.coreTraits.join(', ')}`)
  if (context.temperament) lines.push(`- Temperament: ${context.temperament}`)
  if (context.socialStyle) lines.push(`- Sozialstil: ${context.socialStyle}`)
  if (context.strengths.length > 0) lines.push(`- Staerken: ${context.strengths.join(', ')}`)
  if (context.weaknesses.length > 0) lines.push(`- Schwaechen: ${context.weaknesses.join(', ')}`)
  if (context.quirks.length > 0) lines.push(`- Eigenheiten: ${context.quirks.join(', ')}`)
  if (context.visibleGoal) lines.push(`- Sichtbares Ziel: ${context.visibleGoal}`)
  if (context.fear) lines.push(`- Angst: ${context.fear}`)
  return lines.join('\n')
}

const formatLearningGoalContextText = (contexts: SceneLearningGoalContext[] | undefined): string => {
  if (!contexts || contexts.length === 0) return ''
  const lines = [
    'ACTIVE LEARNING GOALS:',
    '- Wenn ein Lernziel angegeben ist, muss die naechste Szene dieses Lernziel sichtbar stuetzen.',
    '- Das Lernziel ist dann wichtiger als lose Ausschmueckung oder zufaellige Nebenmotive.',
  ]
  for (const context of contexts) {
    const topicGroup = context.topicGroup ? ` | Themenfeld: ${context.topicGroup}` : ''
    const topic = context.topic ? ` | Thema: ${context.topic}` : ''
    const sessionGoal = context.sessionGoal ? ` | Sitzungsziel: ${context.sessionGoal}` : ''
    const endState = context.endState ? ` | Zielzustand: ${context.endState}` : ''
    lines.push(`- ${context.name} (${context.id})${topicGroup}${topic}${sessionGoal}${endState}`)
    if (context.coreIdeas.length > 0) {
      lines.push(`  Kernideen: ${context.coreIdeas.slice(0, 4).join(' | ')}`)
    }
    if (context.assessmentTargets.length > 0) {
      lines.push(`  Pruefbare Aspekte: ${context.assessmentTargets.slice(0, 4).join(' | ')}`)
    }
  }
  return lines.join('\n')
}

const formatGroundedSceneCharactersText = (characters: GroundedSceneCharacter[] | undefined): string =>
  characters && characters.length > 0
    ? [
        'GROUNDED SCENE CHARACTERS:',
        ...characters.map((character) => {
          const evidence =
            character.evidence.length > 0 ? ` | Evidenz: ${character.evidence.join('; ')}` : ''
          const imagePath = character.standardImagePath
            ? ` | Referenzbild: ${character.standardImagePath}`
            : ''
          return `- ${character.displayName} (${character.source})${evidence}${imagePath}`
        }),
      ].join('\n')
    : 'GROUNDED SCENE CHARACTERS:\n- Keine zusaetzlichen Figuren geerdet.'

export const buildStoryHistoryContextText = (history: StoryHistoryContext): string =>
  [
    'WHAT HAPPENED SO FAR:',
    formatHistoryEntries(history.whatHappenedSoFar),
    '',
    ...formatSceneSnapshot('SCENE BEFORE THAT:', history.previousScene),
    '',
    ...formatSceneSnapshot('LAST SCENE (MOST IMPORTANT FOR CONTINUITY):', history.latestScene),
  ].join('\n')

export const buildPublicActivityStreamText = (entries: PublicActivitySummaryEntry[]): string =>
  [
    'FULL PUBLIC ACTIVITY STREAM:',
    formatPublicActivityEntries(entries),
    '',
    'HOW TO READ THIS CONTEXT:',
    '- FULL PUBLIC ACTIVITY STREAM: kompletter oeffentlicher Verlauf in zeitlicher Reihenfolge.',
    '- WHAT HAPPENED SO FAR: aeltere Szenen vor den letzten zwei Bildszenen.',
    '- SCENE BEFORE THAT: die vorletzte Bildszene.',
    '- LAST SCENE (MOST IMPORTANT FOR CONTINUITY): die letzte Bildszene mit der staerksten visuellen Prioritaet.',
  ].join('\n')

const toWorkspacePublicPath = (publicUrlPath: string): string =>
  path.resolve(workspaceRoot, 'public', publicUrlPath.replace(/^\/+/, ''))

const imageExtensionToMimeType = (imagePath: string): string => {
  const extension = path.extname(imagePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  return 'image/jpeg'
}

const buildSceneImageInput = async (
  snapshot: StorySceneSnapshot | null,
): Promise<{ label: string; contentItem: { type: 'input_image'; image_url: string } } | null> => {
  if (!snapshot?.imageUrl) return null
  const imagePath = snapshot.imageUrl.trim()
  if (!imagePath.startsWith('/')) return null
  try {
    const raw = await readFile(toWorkspacePublicPath(imagePath))
    const mimeType = imageExtensionToMimeType(imagePath)
    return {
      label: snapshot === null ? 'scene' : snapshot.timestamp,
      contentItem: {
        type: 'input_image',
        image_url: `data:${mimeType};base64,${raw.toString('base64')}`,
      },
    }
  } catch {
    return null
  }
}

const fallbackNextSceneSummaryForTests = (input: {
  characterName: string
  userRequest: string
  history: StoryHistoryContext
  groundedSceneCharacters?: GroundedSceneCharacter[]
}): string => {
  const cleanRequest = normalizeWhitespace(input.userRequest)
  const continuity = input.history.latestScene?.summary
    ? ` Die neue Szene fuehrt sichtbar weiter, was zuletzt zu sehen war: ${input.history.latestScene.summary}.`
    : ''
  const supportingCharacters = (input.groundedSceneCharacters ?? [])
    .filter((character) => character.source !== 'active-character')
    .map((character) => character.displayName)
  const supportingCharacterText =
    supportingCharacters.length > 0
      ? ` Sichtbar beteiligt waren auch ${supportingCharacters.join(', ')}.`
      : ''
  if (cleanRequest) {
    return normalizeWhitespace(
      `Danach war zu sehen, wie ${input.characterName} ${cleanRequest}.${continuity}${supportingCharacterText}`,
    )
  }
  return normalizeWhitespace(
    `Danach war zu sehen, wie ${input.characterName} einen klaren neuen Moment der Geschichte erlebte.${continuity}${supportingCharacterText}`,
  )
}

const fallbackImagePromptForTests = (input: {
  characterName: string
  userRequest: string
  sceneSummary: string
  history: StoryHistoryContext
  groundedSceneCharacters?: GroundedSceneCharacter[]
}): string => {
  const continuity = [
    input.history.previousScene?.summary ? `Vorher war zu sehen: ${input.history.previousScene.summary}.` : '',
    input.history.latestScene?.summary ? `Zuletzt war zu sehen: ${input.history.latestScene.summary}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
  const groundedCharacters = (input.groundedSceneCharacters ?? [])
    .filter((character) => character.source !== 'active-character')
    .map((character) => character.displayName)
  const groundedCharacterText =
    groundedCharacters.length > 0
      ? ` Weitere klar sichtbare Figuren: ${groundedCharacters.join(', ')}.`
      : ''
  return normalizeWhitespace(
    `Erzeuge ein kindgerechtes Storytime-Bild von ${input.characterName}. Szene: ${input.sceneSummary}. Wunsch: ${input.userRequest}. ${continuity}${groundedCharacterText}`,
  )
}

const fallbackSceneBuildForTests = (input: {
  characterName: string
  userRequest: string
  history: StoryHistoryContext
  groundedSceneCharacters?: GroundedSceneCharacter[]
}): SceneBuildResult => {
  const sceneSummary = fallbackNextSceneSummaryForTests(input)
  const imagePrompt = fallbackImagePromptForTests({
    characterName: input.characterName,
    userRequest: input.userRequest,
    sceneSummary,
    history: input.history,
    groundedSceneCharacters: input.groundedSceneCharacters,
  })
  return { sceneSummary, imagePrompt }
}

const readResponsesText = (body: {
  output_text?: string
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>
  }>
}): string =>
  readText(body.output_text) ||
  readText(
    body.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === 'output_text' && typeof item.text === 'string')
      ?.text,
  )

const parseSceneBuildResult = (raw: string): SceneBuildResult | null => {
  const tryParse = (value: string): SceneBuildResult | null => {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>
      const sceneSummary = readText(parsed.sceneSummary)
      const imagePrompt = readText(parsed.imagePrompt)
      if (!sceneSummary || !imagePrompt) return null
      return {
        sceneSummary: normalizeWhitespace(sceneSummary),
        imagePrompt,
      }
    } catch {
      return null
    }
  }

  const direct = tryParse(raw)
  if (direct) return direct

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    const fencedResult = tryParse(fenced[1].trim())
    if (fencedResult) return fencedResult
  }

  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return tryParse(raw.slice(firstBrace, lastBrace + 1))
  }

  return null
}

export const generateSceneSummaryAndImagePrompt = async (input: {
  characterName: string
  characterContext?: SceneCharacterContext
  learningGoalContexts?: SceneLearningGoalContext[]
  userRequest: string
  assistantText?: string
  history: StoryHistoryContext
  publicActivityStream: PublicActivitySummaryEntry[]
  groundedSceneCharacters?: GroundedSceneCharacter[]
}): Promise<SceneBuildResult> => {
  const apiKey = getOpenAiApiKey()
  if (!apiKey || process.env.NODE_ENV === 'test') {
    if (!apiKey) {
      throw new Error('scene-build-unavailable:missing-openai-api-key')
    }
    return fallbackSceneBuildForTests({
      characterName: input.characterName,
      userRequest: input.userRequest,
      history: input.history,
      groundedSceneCharacters: input.groundedSceneCharacters,
    })
  }

  try {
    const sceneSummaryInstructions = await loadSceneSummaryPrompt()
    const imagePromptInstructions = await loadImagePromptPrompt()
    const characterContextText = formatCharacterContextText(input.characterContext)
    const learningGoalContextText = formatLearningGoalContextText(input.learningGoalContexts)
    const combinedText = [
      `HAUPTFIGUR: ${input.characterName}`,
      '',
      characterContextText,
      '',
      learningGoalContextText,
      '',
      'TEIL 1 - SZENEN-SUMMARY-REGELN:',
      sceneSummaryInstructions,
      '',
      'TEIL 2 - BILDPROMPT-REGELN:',
      imagePromptInstructions,
      '',
      'USER REQUEST:',
      normalizeWhitespace(input.userRequest),
      '',
      input.assistantText ? `ASSISTANT TEXT HINT:\n${normalizeWhitespace(input.assistantText)}` : '',
      '',
      'WICHTIGER ARBEITSMODUS:',
      '- Erzeuge zuerst intern eine kindgerechte Scene Summary (2-4 kurze deutsche Saetze).',
      '- Erzeuge danach den Bildprompt ausschliesslich aus dieser Scene Summary.',
      '- Nutze die letzten zwei Szenenbilder als Kontinuitaetsanker (LAST SCENE hat hoehere Prioritaet).',
      '- Gib als Antwort NUR gueltiges JSON ohne Markdown.',
      '- JSON-Schema: {"sceneSummary":"...","imagePrompt":"..."}',
      '- Beide Felder sind Pflichtfelder und duerfen nicht leer sein.',
      '',
      formatGroundedSceneCharactersText(input.groundedSceneCharacters),
      '',
      buildPublicActivityStreamText(input.publicActivityStream),
      '',
      buildStoryHistoryContextText(input.history),
    ]
      .filter(Boolean)
      .join('\n')

    const imageInputs = (
      await Promise.all([
        buildSceneImageInput(input.history.previousScene),
        buildSceneImageInput(input.history.latestScene),
      ])
    ).filter((item): item is { label: string; contentItem: { type: 'input_image'; image_url: string } } => item !== null)

    let response: Response
    try {
      response = await fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: IMAGE_PROMPT_MODEL,
          input: [
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: combinedText,
                },
                ...imageInputs.map((item, index) => [
                  {
                    type: 'input_text' as const,
                    text:
                      index === 0
                        ? 'BILDKONTEXT: SCENE BEFORE THAT. Dieses Bild zeigt die vorletzte Szene.'
                        : 'BILDKONTEXT: LAST SCENE. Dieses Bild zeigt die letzte Szene und hat die staerkste visuelle Prioritaet.',
                  },
                  item.contentItem,
                ]).flat(),
              ],
            },
          ],
          max_output_tokens: 520,
        }),
      })
    } catch (fetchError) {
      throw new Error(compactFetchErrorMessage('scene-build-unavailable', fetchError))
    }
    if (!response.ok) {
      throw new Error(`scene-build-unavailable:http-${response.status}`)
    }
    const body = (await response.json()) as {
      output_text?: string
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>
      }>
    }
    const content = readResponsesText(body)
    if (!content) {
      throw new Error('scene-build-unavailable:empty-response')
    }
    const parsed = parseSceneBuildResult(content)
    if (parsed) return parsed
    return fallbackSceneBuildForTests({
      characterName: input.characterName,
      userRequest: input.userRequest,
      history: input.history,
      groundedSceneCharacters: input.groundedSceneCharacters,
    })
  } catch (error) {
    if (error instanceof Error) throw error
    throw new Error('scene-build-unavailable:unknown')
  }
}

export const generateNextSceneSummary = async (input: {
  characterName: string
  characterContext?: SceneCharacterContext
  learningGoalContexts?: SceneLearningGoalContext[]
  userRequest: string
  assistantText?: string
  history: StoryHistoryContext
  publicActivityStream: PublicActivitySummaryEntry[]
  groundedSceneCharacters?: GroundedSceneCharacter[]
}): Promise<string> => {
  const result = await generateSceneSummaryAndImagePrompt(input)
  return result.sceneSummary
}

export const generateImagePromptFromSceneSummary = async (input: {
  characterName: string
  userRequest: string
  sceneSummary: string
  history: StoryHistoryContext
  groundedSceneCharacters?: GroundedSceneCharacter[]
}): Promise<string> =>
  fallbackImagePromptForTests({
    characterName: input.characterName,
    userRequest: input.userRequest,
    sceneSummary: input.sceneSummary,
    history: input.history,
    groundedSceneCharacters: input.groundedSceneCharacters,
  })

export const pickPreferredCharacterImagePath = (imageRefs: CollatedImageRef[]): string | undefined =>
  imageRefs.find((item) => item.kind === 'standard')?.path

export const collectMentionedRelatedObjects = (input: {
  text: string
  relationshipLinks: SceneRelationshipLink[]
}): Array<{ type: string; id: string; label?: string }> => {
  const haystack = normalizeText(input.text)
  const matches = new Map<string, { type: string; id: string; label?: string }>()

  for (const link of input.relationshipLinks) {
    for (const object of link.otherRelatedObjects ?? []) {
      const candidates = [object.label, object.id]
        .map((item) => readText(item))
        .filter((item) => item.length > 0)
      if (!candidates.some((item) => includesExactTerm(haystack, item))) continue
      matches.set(`${object.type}:${object.id}`, {
        type: object.type,
        id: object.id,
        label: object.label,
      })
    }
  }

  return Array.from(matches.values())
}

const computeGroundingScore = (input: {
  haystack: string
  candidate: CharacterGroundingCandidate
}): number => {
  let score = 0
  if (input.candidate.source === 'active-character') score += 100
  if (includesExactTerm(input.haystack, input.candidate.displayName)) score += 8
  if (includesExactTerm(input.haystack, input.candidate.characterId)) score += 6
  if (input.candidate.evidence.some((entry) => includesExactTerm(input.haystack, entry))) score += 5

  const relationshipTerms = (input.candidate.relationshipLinks ?? [])
    .flatMap((link) => [link.relationshipTypeReadable, link.relationshipType, link.relationship])
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length > 0)
  if (relationshipTerms.some((entry) => includesExactTerm(input.haystack, entry))) score += 3
  if (
    matchesRelationshipRoleReference({
      haystack: input.haystack,
      relationshipLinks: input.candidate.relationshipLinks ?? [],
    })
  ) {
    score += 6
  }
  if (includesExactTerm(input.haystack, 'freund') || includesExactTerm(input.haystack, 'freunde')) {
    if (relationshipTerms.some((entry) => normalizeText(entry).includes('freund'))) {
      score += 2
    }
  }
  if (input.candidate.source === 'object-context') score += 4
  return score
}

export const selectGroundedSceneCharacters = (input: {
  mainCharacterId: string
  mainCharacterName: string
  mainCharacterImageRefs: CollatedImageRef[]
  userRequest: string
  nextSceneSummary: string
  directRelatedObjects: CollatedRelatedObject[]
  contextualRelatedObjects: Array<CollatedRelatedObject & { evidence?: string[] }>
}): GroundedSceneCharacter[] => {
  const haystack = normalizeText(`${input.userRequest} ${input.nextSceneSummary}`)
  const candidates = new Map<string, CharacterGroundingCandidate>()

  const upsert = (candidate: CharacterGroundingCandidate) => {
    const existing = candidates.get(candidate.characterId)
    if (!existing) {
      candidates.set(candidate.characterId, candidate)
      return
    }
    const mergedEvidence = Array.from(new Set([...existing.evidence, ...candidate.evidence]))
    const mergedLinks = [...(existing.relationshipLinks ?? []), ...(candidate.relationshipLinks ?? [])]
    const mergedImageRefs = existing.imageRefs.length > 0 ? existing.imageRefs : candidate.imageRefs
    candidates.set(candidate.characterId, {
      ...existing,
      source: existing.source === 'active-character' ? existing.source : candidate.source,
      evidence: mergedEvidence,
      relationshipLinks: mergedLinks,
      imageRefs: mergedImageRefs,
    })
  }

  upsert({
    characterId: input.mainCharacterId,
    displayName: input.mainCharacterName,
    imageRefs: input.mainCharacterImageRefs,
    source: 'active-character',
    evidence: [],
  })

  for (const item of input.directRelatedObjects) {
    upsert({
      characterId: item.objectId,
      displayName: item.displayName,
      imageRefs: item.imageRefs,
      source: 'relationship-name-match',
      evidence: item.evidence,
      relationshipLinks: item.relationshipLinks.map((link) => ({
        relationshipType: link.relationshipType,
        relationshipTypeReadable: link.relationshipTypeReadable,
        relationship: link.relationship,
      })),
    })
  }

  for (const item of input.contextualRelatedObjects) {
    upsert({
      characterId: item.objectId,
      displayName: item.displayName,
      imageRefs: item.imageRefs,
      source: 'object-context',
      evidence: item.evidence ?? [],
      relationshipLinks: item.relationshipLinks.map((link) => ({
        relationshipType: link.relationshipType,
        relationshipTypeReadable: link.relationshipTypeReadable,
        relationship: link.relationship,
      })),
    })
  }

  return Array.from(candidates.values())
    .map((candidate) => ({
      candidate,
      score: computeGroundingScore({
        haystack,
        candidate,
      }),
    }))
    .filter((entry) => entry.candidate.source === 'active-character' || entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((entry) => ({
      characterId: entry.candidate.characterId,
      displayName: entry.candidate.displayName,
      source:
        entry.candidate.source === 'relationship-name-match' && entry.score >= 3
          ? 'relationship-name-match'
          : entry.candidate.source === 'active-character'
            ? 'active-character'
            : entry.candidate.source === 'object-context'
              ? 'object-context'
              : 'relationship-role-match',
      evidence: Array.from(new Set(entry.candidate.evidence)).slice(0, 6),
      standardImagePath: pickPreferredCharacterImagePath(entry.candidate.imageRefs),
    }))
}

