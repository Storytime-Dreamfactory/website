import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ContentManifest } from '../../../src/content/types.ts'

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

export const readContentManifest = async (manifestPath: string): Promise<ContentManifest> => {
  const absolutePath = path.resolve(manifestPath)
  const raw = await readFile(absolutePath, 'utf8')
  const parsed = JSON.parse(raw) as unknown

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Invalid content manifest at ${absolutePath}`)
  }

  const maybeManifest = parsed as Record<string, unknown>
  if (
    !isStringList(maybeManifest.characters) ||
    !isStringList(maybeManifest.places) ||
    !isStringList(maybeManifest.learningGoals) ||
    !isStringList(maybeManifest.artifacts)
  ) {
    throw new Error(`Invalid content manifest shape at ${absolutePath}`)
  }

  return {
    characters: maybeManifest.characters,
    places: maybeManifest.places,
    learningGoals: maybeManifest.learningGoals,
    artifacts: maybeManifest.artifacts,
  }
}
