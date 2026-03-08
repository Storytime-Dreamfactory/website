import { parse } from 'yaml'
import type {
  Character,
  CharacterRelationshipToCharacter,
  ContentManifest,
  StoryContent,
} from './types'
import { validateCharacter, validateLearningGoal, validatePlace } from './validators'

const fallbackCharacterFiles = import.meta.glob('../../content/characters/*/character.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const fallbackPlaceFiles = import.meta.glob('../../content/places/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const fallbackLearningGoalFiles = import.meta.glob('../../content/learning-goals/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const deriveIdFromPath = (filePath: string): string => {
  const segments = filePath.split('/')
  const fileName = segments.pop() ?? ''
  if (/^character\.ya?ml$/i.test(fileName)) {
    return segments.pop() ?? 'unknown'
  }
  return fileName.replace(/\.ya?ml$/i, '') || 'unknown'
}

const parseYaml = (rawYaml: string, filePath: string): unknown => {
  try {
    return parse(rawYaml)
  } catch (error) {
    throw new Error(`YAML parse failed for ${filePath}: ${String(error)}`)
  }
}

const loadRuntimeManifest = async (): Promise<ContentManifest> => {
  const response = await fetch('/content-manifest.json')
  if (!response.ok) {
    throw new Error(`Runtime manifest could not be loaded: ${response.status}`)
  }

  return (await response.json()) as ContentManifest
}

const loadRuntimeYaml = async (path: string): Promise<unknown> => {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Runtime YAML could not be loaded: ${path} (${response.status})`)
  }
  return parseYaml(await response.text(), path)
}

type DbRelationshipResponse = {
  relationships: Array<{
    sourceCharacterId: string
    targetCharacterId: string
    relationshipType: string
    relationship: string
    description?: string
  }>
}

const mergeRelationshipsFromDatabase = async (
  characters: Character[],
): Promise<{ characters: Character[]; warning?: string }> => {
  try {
    const response = await fetch('/api/relationships/all')
    if (!response.ok) {
      throw new Error(`Relationships API failed: ${response.status}`)
    }

    const payload = (await response.json()) as DbRelationshipResponse
    const relationships = Array.isArray(payload.relationships) ? payload.relationships : []

    const relationshipMap = new Map<string, CharacterRelationshipToCharacter[]>()
    for (const relationship of relationships) {
      const source = relationship.sourceCharacterId?.trim()
      const target = relationship.targetCharacterId?.trim()
      if (!source || !target) continue

      const nextEntry: CharacterRelationshipToCharacter = {
        characterId: target,
        type: relationship.relationship || relationship.relationshipType || 'related_to',
        description: relationship.description?.trim() || undefined,
      }
      const current = relationshipMap.get(source) ?? []
      current.push(nextEntry)
      relationshipMap.set(source, current)
    }

    const mergedCharacters = characters.map((character) => ({
      ...character,
      relationships: {
        characters: relationshipMap.get(character.id) ?? [],
        places: character.relationships?.places ?? [],
      },
    }))

    return { characters: mergedCharacters }
  } catch (error) {
    return {
      characters,
      warning: `DB relationships unavailable, fallback to YAML relationships: ${String(error)}`,
    }
  }
}

const loadFromRuntime = async (): Promise<StoryContent> => {
  const manifest = await loadRuntimeManifest()

  const [characters, places, learningGoals] = await Promise.all([
    Promise.all(
      manifest.characters.map(async (path) => {
        const parsed = await loadRuntimeYaml(path)
        return validateCharacter(parsed, deriveIdFromPath(path), path)
      }),
    ),
    Promise.all(
      manifest.places.map(async (path) => {
        const parsed = await loadRuntimeYaml(path)
        return validatePlace(parsed, deriveIdFromPath(path), path)
      }),
    ),
    Promise.all(
      manifest.learningGoals.map(async (path) => {
        const parsed = await loadRuntimeYaml(path)
        return validateLearningGoal(parsed, deriveIdFromPath(path), path)
      }),
    ),
  ])

  const merged = await mergeRelationshipsFromDatabase(characters)

  return {
    characters: merged.characters,
    places,
    learningGoals,
    source: 'runtime',
    warnings: merged.warning ? [merged.warning] : [],
  }
}

const loadFromFallback = (reason: string): StoryContent => {
  const characters = Object.entries(fallbackCharacterFiles).map(([filePath, rawYaml]) => {
    const parsed = parseYaml(rawYaml, filePath)
    return validateCharacter(parsed, deriveIdFromPath(filePath), filePath)
  })

  const places = Object.entries(fallbackPlaceFiles).map(([filePath, rawYaml]) => {
    const parsed = parseYaml(rawYaml, filePath)
    return validatePlace(parsed, deriveIdFromPath(filePath), filePath)
  })

  const learningGoals = Object.entries(fallbackLearningGoalFiles).map(([filePath, rawYaml]) => {
    const parsed = parseYaml(rawYaml, filePath)
    return validateLearningGoal(parsed, deriveIdFromPath(filePath), filePath)
  })

  return {
    characters,
    places,
    learningGoals,
    source: 'fallback',
    warnings: [reason],
  }
}

export const loadStoryContent = async (): Promise<StoryContent> => {
  try {
    return await loadFromRuntime()
  } catch (error) {
    const fallback = loadFromFallback(String(error))
    const merged = await mergeRelationshipsFromDatabase(fallback.characters)
    return {
      ...fallback,
      characters: merged.characters,
      warnings: merged.warning ? [...fallback.warnings, merged.warning] : fallback.warnings,
    }
  }
}
