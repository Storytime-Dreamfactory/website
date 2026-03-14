import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { validateCharacter, validatePlace } from '../../../src/content/validators.ts'
import type { Character, Place } from '../../../src/content/types.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

type ExistingCharacterContext = Pick<
  Character,
  'id' | 'name' | 'shortDescription' | 'basis' | 'appearance' | 'tags' | 'origin'
>

type ExistingPlaceContext = Pick<Place, 'id' | 'name' | 'description'>

export type WorldContext = {
  characters: ExistingCharacterContext[]
  places: ExistingPlaceContext[]
}

const loadYamlFilesFlat = async (directoryPath: string): Promise<Array<{ filePath: string; content: string }>> => {
  const fileNames = await readdir(directoryPath)
  const yamlNames = fileNames.filter((fileName) => /\.ya?ml$/i.test(fileName))

  return Promise.all(
    yamlNames.map(async (fileName) => ({
      filePath: path.resolve(directoryPath, fileName),
      content: await readFile(path.resolve(directoryPath, fileName), 'utf8'),
    })),
  )
}

const loadCharacterYamlsFromSubfolders = async (
  parentDirectory: string,
): Promise<Array<{ filePath: string; content: string }>> => {
  const entries = await readdir(parentDirectory, { withFileTypes: true })
  const subDirectories = entries.filter((entry) => entry.isDirectory())

  const results: Array<{ filePath: string; content: string }> = []

  for (const subDir of subDirectories) {
    const characterYamlPath = path.resolve(parentDirectory, subDir.name, 'character.yaml')
    try {
      const content = await readFile(characterYamlPath, 'utf8')
      results.push({ filePath: characterYamlPath, content })
    } catch {
      // subfolder without character.yaml — skip
    }
  }

  return results
}

export const loadWorldContext = async (): Promise<WorldContext> => {
  const [characterFiles, placeFiles] = await Promise.all([
    loadCharacterYamlsFromSubfolders(path.resolve(workspaceRoot, 'content/characters')),
    loadYamlFilesFlat(path.resolve(workspaceRoot, 'content/places')),
  ])

  const characters = characterFiles.map(({ filePath, content }) => {
    const parsed = parse(content)
    const yamlId =
      parsed && typeof parsed === 'object' && typeof (parsed as { id?: unknown }).id === 'string'
        ? ((parsed as { id: string }).id ?? '').trim()
        : ''
    const fallbackId = path.basename(path.dirname(filePath))
    return validateCharacter(parsed, yamlId || fallbackId, filePath)
  })

  const places = placeFiles.map(({ filePath, content }) => {
    const parsed = parse(content)
    const fallbackId = path.basename(filePath, path.extname(filePath))
    return validatePlace(parsed, fallbackId, filePath)
  })

  return {
    characters,
    places,
  }
}

export const serializeWorldContextForPrompt = (context: WorldContext): string => {
  const characterLines = context.characters.map((c) => {
    const role = c.basis.roleArchetype ?? 'unbekannt'
    const colors = c.appearance.colors.join(', ')
    return `- ${c.id}: ${c.name}, ${c.basis.species}, Rolle: ${role}, Farben: ${colors}`
  })

  const placeLines = context.places.map((p) => `- ${p.id}: ${p.name}`)

  const sections: string[] = []

  if (characterLines.length > 0) {
    sections.push(`Existierende Charaktere:\n${characterLines.join('\n')}`)
  }

  if (placeLines.length > 0) {
    sections.push(`Existierende Orte:\n${placeLines.join('\n')}`)
  }

  return sections.length > 0
    ? sections.join('\n\n')
    : 'Die Welt ist noch leer. Erstelle den ersten Charakter.'
}
