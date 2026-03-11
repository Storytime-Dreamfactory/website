import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { removeCharacterFromManifest } from './saveCharacterYaml.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

const deleteIfPresent = async (targetPath: string): Promise<void> => {
  await rm(targetPath, { recursive: true, force: true })
}

export const deleteCharacterArtifacts = async (characterId: string): Promise<void> => {
  const runtimePath = `/content/characters/${characterId}/character.yaml`

  await Promise.all([
    deleteIfPresent(path.resolve(workspaceRoot, `content/characters/${characterId}`)),
    deleteIfPresent(path.resolve(workspaceRoot, `public/content/characters/${characterId}`)),
  ])

  await removeCharacterFromManifest(runtimePath)
}
