import { parse } from 'yaml'
import type { ContentManifest, StoryContent } from './types'
import { validateCharacter, validatePlace, validateSkill } from './validators'

const fallbackCharacterFiles = import.meta.glob('../../content/characters/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const fallbackPlaceFiles = import.meta.glob('../../content/places/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const fallbackSkillFiles = import.meta.glob('../../content/skills/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const deriveIdFromPath = (filePath: string): string =>
  filePath.split('/').pop()?.replace(/\.ya?ml$/i, '') ?? 'unknown'

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

const loadFromRuntime = async (): Promise<StoryContent> => {
  const manifest = await loadRuntimeManifest()

  const [characters, places, skills] = await Promise.all([
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
      manifest.skills.map(async (path) => {
        const parsed = await loadRuntimeYaml(path)
        return validateSkill(parsed, deriveIdFromPath(path), path)
      }),
    ),
  ])

  return {
    characters,
    places,
    skills,
    source: 'runtime',
    warnings: [],
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

  const skills = Object.entries(fallbackSkillFiles).map(([filePath, rawYaml]) => {
    const parsed = parseYaml(rawYaml, filePath)
    return validateSkill(parsed, deriveIdFromPath(filePath), filePath)
  })

  return {
    characters,
    places,
    skills,
    source: 'fallback',
    warnings: [reason],
  }
}

export const loadStoryContent = async (): Promise<StoryContent> => {
  try {
    return await loadFromRuntime()
  } catch (error) {
    return loadFromFallback(String(error))
  }
}
