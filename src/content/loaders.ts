import { parse } from 'yaml'
import type {
  Artifact,
  Character,
  CharacterRelationshipToCharacter,
  LearningGoal,
  Place,
  StoryContent,
} from './types'
import { validateArtifact, validateCharacter, validateLearningGoal, validatePlace } from './validators'

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

const fallbackLearningGoalFiles = import.meta.glob('../../content/learning-goals/*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const fallbackArtifactFiles = import.meta.glob('../../content/artifacts/*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const deriveSlugFromPath = (filePath: string): string => {
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

const asRuntimeRecord = (rawObject: unknown, runtimePath: string): Record<string, unknown> => {
  if (!rawObject || typeof rawObject !== 'object' || Array.isArray(rawObject)) {
    throw new Error(`Invalid runtime object in ${runtimePath}`)
  }
  return rawObject as Record<string, unknown>
}

const assertRuntimeObjectType = (
  objectRecord: Record<string, unknown>,
  objectType: 'character' | 'place' | 'learning-goals' | 'artifact',
  runtimePath: string,
): void => {
  if (objectRecord.type !== objectType) {
    throw new Error(`Invalid "type" in ${runtimePath}`)
  }
}

const normalizeRuntimeGameObject = (
  rawObject: unknown,
  objectType: 'character' | 'place' | 'learning-goals' | 'artifact',
  index: number,
): Character | Place | LearningGoal | Artifact => {
  const objectRecord = asRuntimeRecord(rawObject, `runtime:${objectType}:${index + 1}`)
  const slugCandidate =
    typeof objectRecord?.slug === 'string' && objectRecord.slug.trim().length > 0
      ? objectRecord.slug.trim()
      : typeof objectRecord?.id === 'string' && objectRecord.id.trim().length > 0
        ? objectRecord.id.trim()
        : `${objectType}-${index + 1}`
  const runtimePath = `runtime:${objectType}:${slugCandidate}`

  switch (objectType) {
    case 'character': {
      assertRuntimeObjectType(objectRecord, objectType, runtimePath)
      // Runtime API liefert bereits normalisierte Character-Objekte in camelCase.
      if ('voiceProfile' in objectRecord) return objectRecord as Character
      return validateCharacter(rawObject, slugCandidate, runtimePath)
    }
    case 'place': {
      assertRuntimeObjectType(objectRecord, objectType, runtimePath)
      if ('description' in objectRecord && !('map_position' in objectRecord)) return objectRecord as Place
      return validatePlace(rawObject, slugCandidate, runtimePath)
    }
    case 'learning-goals': {
      assertRuntimeObjectType(objectRecord, objectType, runtimePath)
      if (
        'topicGroup' in objectRecord ||
        'learningObjectives' in objectRecord ||
        'ageRange' in objectRecord ||
        'exampleQuestions' in objectRecord ||
        'practiceIdeas' in objectRecord ||
        'domainTags' in objectRecord
      ) {
        return objectRecord as LearningGoal
      }
      return validateLearningGoal(rawObject, slugCandidate, runtimePath)
    }
    case 'artifact': {
      assertRuntimeObjectType(objectRecord, objectType, runtimePath)
      if ('artifactType' in objectRecord && 'sensoryProfile' in objectRecord) {
        return objectRecord as Artifact
      }
      return validateArtifact(rawObject, slugCandidate, runtimePath)
    }
  }
}

const loadRuntimeGameObjects = async <T>(objectType: string): Promise<T[]> => {
  const response = await fetch(`/api/game-objects?type=${encodeURIComponent(objectType)}`)
  if (!response.ok) {
    throw new Error(`GameObjects API could not be loaded for ${objectType}: ${response.status}`)
  }

  const payload = (await response.json()) as { gameObjects?: unknown[] }
  const runtimeObjects = Array.isArray(payload.gameObjects) ? payload.gameObjects : []

  return runtimeObjects
    .map((runtimeObject, index) =>
      normalizeRuntimeGameObject(
        runtimeObject,
        objectType as 'character' | 'place' | 'learning-goals' | 'artifact',
        index,
      ),
    )
    .filter(Boolean) as T[]
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
        places: [],
      },
    }))

    return { characters: mergedCharacters }
  } catch (error) {
    const normalizedCharacters = characters.map((character) => ({
      ...character,
      relationships: {
        characters: [],
        places: [],
      },
    }))
    return {
      characters: normalizedCharacters,
      warning: `DB relationships unavailable: ${String(error)}`,
    }
  }
}

const loadFromRuntime = async (): Promise<StoryContent> => {
  const [characters, places, learningGoals, artifacts] = await Promise.all([
    loadRuntimeGameObjects<Character>('character'),
    loadRuntimeGameObjects<Place>('place'),
    loadRuntimeGameObjects<LearningGoal>('learning-goals'),
    loadRuntimeGameObjects<Artifact>('artifact'),
  ])

  const merged = await mergeRelationshipsFromDatabase(characters)

  return {
    characters: merged.characters,
    places,
    learningGoals,
    artifacts,
    source: 'runtime',
    warnings: merged.warning ? [merged.warning] : [],
  }
}

const loadFromFallback = (reason: string): StoryContent => {
  const characters = Object.entries(fallbackCharacterFiles).map(([filePath, rawYaml]) => {
    const parsed = parseYaml(rawYaml, filePath)
    return validateCharacter(parsed, deriveSlugFromPath(filePath), filePath)
  })

  const places = Object.entries(fallbackPlaceFiles).map(([filePath, rawYaml]) => {
    const parsed = parseYaml(rawYaml, filePath)
    return validatePlace(parsed, deriveSlugFromPath(filePath), filePath)
  })

  const learningGoals = Object.entries(fallbackLearningGoalFiles).map(([filePath, rawYaml]) => {
    const parsed = parseYaml(rawYaml, filePath)
    return validateLearningGoal(parsed, deriveSlugFromPath(filePath), filePath)
  })

  const artifacts = Object.entries(fallbackArtifactFiles).map(([filePath, rawYaml]) => {
    const parsed = parseYaml(rawYaml, filePath)
    return validateArtifact(parsed, deriveSlugFromPath(filePath), filePath)
  })

  return {
    characters,
    places,
    learningGoals,
    artifacts,
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
