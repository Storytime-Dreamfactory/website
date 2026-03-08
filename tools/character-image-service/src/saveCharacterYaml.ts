import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, stringify } from 'yaml'
import { validateCharacter } from '../../../src/content/validators.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

const characterManifestPath = path.resolve(workspaceRoot, 'public/content-manifest.json')

const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

export const saveCharacterYaml = async (yamlText: string): Promise<{
  characterId: string
  contentPath: string
  publicPath: string
  normalizedYamlText: string
}> => {
  const parsed = parse(yamlText) as unknown

  if (typeof parsed !== 'object' || parsed === null || !('id' in parsed)) {
    throw new Error('Character YAML requires a root "id" field')
  }

  const rawId = (parsed as { id?: unknown }).id
  if (typeof rawId !== 'string' || rawId.trim().length === 0) {
    throw new Error('Character YAML requires a non-empty string "id" field')
  }

  const characterId = slugify(rawId)
  if (!characterId) {
    throw new Error('Character id could not be normalized')
  }

  const normalizedDocument = {
    ...(parsed as Record<string, unknown>),
    id: characterId,
  }

  const contentPath = path.resolve(workspaceRoot, `content/characters/${characterId}/character.yaml`)
  const publicPath = path.resolve(workspaceRoot, `public/content/characters/${characterId}/character.yaml`)

  validateCharacter(normalizedDocument, characterId, contentPath)

  const normalizedYamlText = stringify(normalizedDocument, {
    lineWidth: 0,
  }).trimEnd() + '\n'

  await mkdir(path.dirname(contentPath), { recursive: true })
  await mkdir(path.dirname(publicPath), { recursive: true })
  await writeFile(contentPath, normalizedYamlText, 'utf8')
  await writeFile(publicPath, normalizedYamlText, 'utf8')

  const manifestRaw = await readFile(characterManifestPath, 'utf8')
  const manifest = JSON.parse(manifestRaw) as {
    characters: string[]
    places: string[]
    skills: string[]
  }

  const runtimePath = `/content/characters/${characterId}/character.yaml`
  if (!manifest.characters.includes(runtimePath)) {
    manifest.characters = [...manifest.characters, runtimePath]
  }

  await writeFile(characterManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return {
    characterId,
    contentPath,
    publicPath,
    normalizedYamlText,
  }
}
