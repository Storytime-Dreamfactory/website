import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { validateCharacter } from '../../../src/content/validators.ts'
import type { Character } from '../../../src/content/types.ts'

const deriveIdFromPath = (filePath: string): string => {
  const baseName = path.basename(filePath, path.extname(filePath))
  if (baseName === 'character') {
    return path.basename(path.dirname(filePath))
  }
  return baseName
}

export const loadCharacterFromYaml = async (filePath: string): Promise<Character> => {
  const absolutePath = path.resolve(filePath)
  const rawYaml = await readFile(absolutePath, 'utf8')
  const parsed = parse(rawYaml)

  return validateCharacter(parsed, deriveIdFromPath(absolutePath), absolutePath)
}
