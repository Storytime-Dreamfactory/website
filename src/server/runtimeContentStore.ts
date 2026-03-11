import { readFile } from 'node:fs/promises'
import { parse as parseYaml } from 'yaml'
import { resolveYamlPathForGameObject } from './gameObjectService.ts'

type CharacterYaml = {
  name?: string
  kurzbeschreibung?: string
  basis?: {
    species?: string
  }
  persoenlichkeit?: {
    core_traits?: string[]
  }
  learning_function?: {
    suitable_learning_goals?: string[]
  }
}

type LearningGoalYaml = {
  name?: string
  topic?: string
  description?: string
  age_range?: string[]
  example_questions?: string[]
  practice_ideas?: string[]
  domain_tags?: string[]
}

export type CharacterRuntimeProfile = {
  id: string
  name: string
  species: string
  shortDescription: string
  coreTraits: string[]
  suitableLearningGoalIds: string[]
}

export type LearningGoalRuntimeProfile = {
  id: string
  name: string
  topic: string
  description: string
  ageRange: string[]
  exampleQuestions: string[]
  practiceIdeas: string[]
  domainTags: string[]
}

const characterProfileCache = new Map<string, Promise<CharacterRuntimeProfile | null>>()
const learningGoalCache = new Map<string, Promise<LearningGoalRuntimeProfile | null>>()

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const readTextArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export const loadCharacterRuntimeProfile = async (
  characterId: string,
): Promise<CharacterRuntimeProfile | null> => {
  const normalizedId = characterId.trim()
  if (!normalizedId) return null

  const existing = characterProfileCache.get(normalizedId)
  if (existing) return existing

  const nextPromise = (async () => {
    try {
      const yamlPath = await resolveYamlPathForGameObject(normalizedId, 'character')
      if (!yamlPath) return null
      const raw = await readFile(yamlPath, 'utf8')
      const parsed = parseYaml(raw) as CharacterYaml
      return {
        id: normalizedId,
        name: readText(parsed.name) || normalizedId,
        species: readText(parsed.basis?.species),
        shortDescription: readText(parsed.kurzbeschreibung),
        coreTraits: readTextArray(parsed.persoenlichkeit?.core_traits),
        suitableLearningGoalIds: readTextArray(
          parsed.learning_function?.suitable_learning_goals,
        ),
      }
    } catch {
      return null
    }
  })()

  characterProfileCache.set(normalizedId, nextPromise)
  return nextPromise
}

export const loadLearningGoalRuntimeProfile = async (
  learningGoalId: string,
): Promise<LearningGoalRuntimeProfile | null> => {
  const normalizedId = learningGoalId.trim()
  if (!normalizedId) return null

  const existing = learningGoalCache.get(normalizedId)
  if (existing) return existing

  const nextPromise = (async () => {
    try {
      const yamlPath = await resolveYamlPathForGameObject(normalizedId, 'learning-goals')
      if (!yamlPath) return null
      const raw = await readFile(yamlPath, 'utf8')
      const parsed = parseYaml(raw) as LearningGoalYaml
      return {
        id: normalizedId,
        name: readText(parsed.name) || normalizedId,
        topic: readText(parsed.topic),
        description: readText(parsed.description),
        ageRange: readTextArray(parsed.age_range),
        exampleQuestions: readTextArray(parsed.example_questions),
        practiceIdeas: readTextArray(parsed.practice_ideas),
        domainTags: readTextArray(parsed.domain_tags),
      }
    } catch {
      return null
    }
  })()

  learningGoalCache.set(normalizedId, nextPromise)
  return nextPromise
}

export const loadLearningGoalRuntimeProfiles = async (
  learningGoalIds: string[],
): Promise<LearningGoalRuntimeProfile[]> => {
  const profiles = await Promise.all(
    learningGoalIds
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => loadLearningGoalRuntimeProfile(item)),
  )
  return profiles.filter((item): item is LearningGoalRuntimeProfile => item !== null)
}

export const loadCharacterRuntimeProfiles = async (
  characterIds: string[],
): Promise<CharacterRuntimeProfile[]> => {
  const profiles = await Promise.all(
    characterIds
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .map((item) => loadCharacterRuntimeProfile(item)),
  )
  return profiles.filter((item): item is CharacterRuntimeProfile => item !== null)
}
