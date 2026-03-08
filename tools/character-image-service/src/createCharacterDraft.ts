import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import type { WorldContext } from './loadWorldContext.ts'
import { serializeWorldContextForPrompt } from './loadWorldContext.ts'
import { generateCharacterYaml, retryWithFeedback } from './llmClient.ts'
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

const buildUserMessage = (prompt: string, context: WorldContext): string => {
  const worldSummary = serializeWorldContextForPrompt(context)
  const today = new Date().toISOString().slice(0, 10)

  return [
    `Erstelle einen neuen Charakter basierend auf folgender Beschreibung:`,
    '',
    prompt,
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

const normalizeYaml = (
  yamlText: string,
  characterId: string,
): string => {
  const parsed = parse(yamlText) as Record<string, unknown>
  parsed.id = characterId

  if (isRecord(parsed.bilder)) {
    for (const key of ['standard_figur', 'hero_image', 'portrait', 'profilbild'] as const) {
      const entry = parsed.bilder[key]
      if (isRecord(entry)) {
        const ext = key === 'hero_image' ? 'jpg' : 'png'
        entry.datei = `/content/characters/${characterId}/${key.replace(/_/g, '-')}.${ext}`
      }
    }
  }

  return stringify(parsed, { lineWidth: 0 })
}

export const createCharacterDraft = async (
  prompt: string,
  context: WorldContext = { characters: [], places: [] },
): Promise<{ characterId: string; yamlText: string }> => {
  const systemPrompt = await loadSystemPrompt()
  const userMessage = buildUserMessage(prompt.trim(), context)

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
