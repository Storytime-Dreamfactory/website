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
    temperament?: string
    social_style?: string
    quirks?: string[]
    strengths?: string[]
    weaknesses?: string[]
  }
  story_psychology?: {
    visible_goal?: string
    fear?: string
  }
  learning_function?: {
    suitable_learning_goals?: string[]
  }
}

type LearningGoalYaml = {
  name?: string
  subject?: string
  topic_group?: string
  topic?: string
  subtopic?: string
  description?: string
  age_range?: string[]
  example_questions?: string[]
  practice_ideas?: string[]
  domain_tags?: string[]
  session?: {
    duration_minutes?: number
    format?: string
    session_goal?: string
    end_state?: string
  }
  curriculum?: {
    domain?: string
    tags?: string[]
    prior_knowledge?: string[]
  }
  teaching_content?: {
    core_ideas?: string[]
    key_vocabulary?: string[]
    examples?: string[]
    misconceptions?: string[]
  }
  didactics?: {
    pedagogy?: string[]
    character_role?: string
    teaching_steps?: string[]
    interaction_rules?: string[]
  }
  learning_objectives?: Array<{
    id?: string
    can_do?: string
    evidence?: string[]
  }>
  quiz?: {
    goal?: string
    assessment_targets?: string[]
    allowed_question_types?: string[]
    example_questions?: string[]
    example_tasks?: string[]
    answer_expectations?: {
      strong_signals?: string[]
      acceptable_signals?: string[]
      weak_signals?: string[]
      misconception_signals?: string[]
    }
    feedback_strategy?: {
      encouragement_style?: string
      hint_sequence?: string[]
      follow_up_prompts?: string[]
    }
  }
}

export type CharacterRuntimeProfile = {
  id: string
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
  suitableLearningGoalIds: string[]
}

export type LearningGoalRuntimeProfile = {
  id: string
  name: string
  subject: string
  topicGroup: string
  topic: string
  subtopic: string
  description: string
  ageRange: string[]
  exampleQuestions: string[]
  practiceIdeas: string[]
  domainTags: string[]
  sessionGoal: string
  endState: string
  coreIdeas: string[]
  assessmentTargets: string[]
  hintSequence: string[]
}

const characterProfileCache = new Map<string, Promise<CharacterRuntimeProfile | null>>()
const learningGoalCache = new Map<string, Promise<LearningGoalRuntimeProfile | null>>()

const characterNameSyncCache = new Map<string, string>()

/**
 * Returns the cached character display name synchronously, or undefined
 * if the character has not been loaded yet.
 */
export const getCharacterNameSync = (characterId: string): string | undefined => {
  return characterNameSyncCache.get(characterId.trim()) ?? undefined
}

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
      const name = readText(parsed.name) || normalizedId
      characterNameSyncCache.set(normalizedId, name)
      return {
        id: normalizedId,
        name,
        species: readText(parsed.basis?.species),
        shortDescription: readText(parsed.kurzbeschreibung),
        coreTraits: readTextArray(parsed.persoenlichkeit?.core_traits),
        temperament: readText(parsed.persoenlichkeit?.temperament),
        socialStyle: readText(parsed.persoenlichkeit?.social_style),
        quirks: readTextArray(parsed.persoenlichkeit?.quirks),
        strengths: readTextArray(parsed.persoenlichkeit?.strengths),
        weaknesses: readTextArray(parsed.persoenlichkeit?.weaknesses),
        visibleGoal: readText(parsed.story_psychology?.visible_goal),
        fear: readText(parsed.story_psychology?.fear),
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
      const quizExampleQuestions =
        readTextArray(parsed.quiz?.example_questions).length > 0
          ? readTextArray(parsed.quiz?.example_questions)
          : readTextArray(parsed.example_questions)
      const domainTags =
        readTextArray(parsed.domain_tags).length > 0
          ? readTextArray(parsed.domain_tags)
          : readTextArray(parsed.curriculum?.tags)
      return {
        id: normalizedId,
        name: readText(parsed.name) || normalizedId,
        subject: readText(parsed.subject),
        topicGroup: readText(parsed.topic_group),
        topic: readText(parsed.topic),
        subtopic: readText(parsed.subtopic),
        description: readText(parsed.description),
        ageRange: readTextArray(parsed.age_range),
        exampleQuestions: quizExampleQuestions,
        practiceIdeas: readTextArray(parsed.practice_ideas),
        domainTags,
        sessionGoal: readText(parsed.session?.session_goal),
        endState: readText(parsed.session?.end_state),
        coreIdeas: readTextArray(parsed.teaching_content?.core_ideas),
        assessmentTargets: readTextArray(parsed.quiz?.assessment_targets),
        hintSequence: readTextArray(parsed.quiz?.feedback_strategy?.hint_sequence),
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
