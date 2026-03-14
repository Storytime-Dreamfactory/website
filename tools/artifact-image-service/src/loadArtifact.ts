import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { validateArtifact } from '../../../src/content/validators.ts'
import type { Artifact } from '../../../src/content/types.ts'

const deriveSlugFromPath = (filePath: string): string => {
  const baseName = path.basename(filePath, path.extname(filePath))
  return baseName || 'unknown-artifact'
}

export const loadArtifactFromYaml = async (filePath: string): Promise<Artifact> => {
  const absolutePath = path.resolve(filePath)
  const rawYaml = await readFile(absolutePath, 'utf8')
  const parsed = parse(rawYaml)
  return validateArtifact(parsed, deriveSlugFromPath(absolutePath), absolutePath)
}
