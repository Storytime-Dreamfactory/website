import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { WorldContext } from './loadWorldContext.ts'
import { serializeWorldContextForPrompt } from './loadWorldContext.ts'
import { generateCharacterYaml, retryWithFeedback } from './llmClient.ts'
import { normalizeCharacterYamlWithStandardImages } from './standardCharacterImages.ts'
import { validateCharacter } from '../../../src/content/validators.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

const SYSTEM_PROMPT_PATH = path.resolve(workspaceRoot, 'content/prompts/character-agent-brief.md')

const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const uniqueId = (baseId: string, context: WorldContext): string => {
  const usedIds = new Set(context.characters.map((character) => character.id))
  if (!usedIds.has(baseId)) {
    return baseId
  }

  let suffix = 2
  while (usedIds.has(`${baseId}-${suffix}`)) {
    suffix += 1
  }

  return `${baseId}-${suffix}`
}

const loadSystemPrompt = async (): Promise<string> =>
  readFile(SYSTEM_PROMPT_PATH, 'utf8')

type CreateCharacterDraftOptions = {
  fillMissingFieldsCreatively?: boolean
  appearanceReferenceSummary?: string
}

const buildUserMessage = (
  prompt: string,
  context: WorldContext,
  options: CreateCharacterDraftOptions,
): string => {
  const worldSummary = serializeWorldContextForPrompt(context)
  const today = new Date().toISOString().slice(0, 10)
  const trimmedPrompt = prompt.trim()
  const promptBlock = trimmedPrompt || 'Keine direkten Nutzereingaben vorhanden.'
  const creationMode = options.fillMissingFieldsCreatively
    ? [
        'Fehlende Details darfst und sollst du kreativ, kindgerecht und schema-treu ausfuellen.',
        'Wenn nur wenig oder gar keine Nutzereingaben vorliegen, erfinde einen vollstaendigen neuen Character, der klar, warm und visuell lesbar ist.',
      ].join(' ')
    : 'Nutze nur das, was aus den Notizen sinnvoll ableitbar ist, und bleibe streng schema-treu.'

  return [
    'Erstelle einen neuen Charakter basierend auf folgenden Character-Notizen.',
    '',
    creationMode,
    '',
    '## Character-Notizen',
    '',
    promptBlock,
    '',
    options.appearanceReferenceSummary
      ? ['## Visuelle Referenz', '', options.appearanceReferenceSummary, ''].join('\n')
      : '',
    '',
    `Heutiges Datum fuer metadata: ${today}`,
    '',
    `## Bestehende Welt`,
    '',
    worldSummary,
  ].join('\n')
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const extractIdFromYaml = (yamlText: string): string | undefined => {
  try {
    const parsed = parse(yamlText) as unknown
    if (isRecord(parsed) && typeof parsed.id === 'string') {
      return parsed.id.trim()
    }
  } catch {
    // ignore parse errors
  }
  return undefined
}

const normalizeYaml = (yamlText: string, characterId: string): string =>
  normalizeCharacterYamlWithStandardImages(yamlText, characterId)

export const createCharacterDraft = async (
  prompt: string,
  context: WorldContext = { characters: [], places: [] },
  options: CreateCharacterDraftOptions = {},
): Promise<{ characterId: string; yamlText: string }> => {
  const systemPrompt = await loadSystemPrompt()
  const userMessage = buildUserMessage(prompt.trim(), context, options)

  let rawYaml = await generateCharacterYaml(systemPrompt, userMessage)

  const rawId = extractIdFromYaml(rawYaml)
  const baseSlug = rawId ? slugify(rawId) : `char-${Date.now()}`
  const characterId = uniqueId(baseSlug || `char-${Date.now()}`, context)

  let yamlText = normalizeYaml(rawYaml, characterId)

  try {
    const parsed = parse(yamlText) as unknown
    validateCharacter(parsed, characterId, `draft:${characterId}`)
  } catch (validationError) {
    const errorMessage =
      validationError instanceof Error ? validationError.message : String(validationError)

    rawYaml = await retryWithFeedback(systemPrompt, userMessage, rawYaml, errorMessage)
    yamlText = normalizeYaml(rawYaml, characterId)

    const retryParsed = parse(yamlText) as unknown
    validateCharacter(retryParsed, characterId, `draft:${characterId}`)
  }

  return { characterId, yamlText }
}
