import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  validateCharacter,
  validatePlace,
  validateLearningGoal,
  validateArtifact,
} from '../content/validators.ts'
import type {
  GameObject,
  GameObjectRef,
  GameObjectType,
} from '../content/types.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))

type ObjectIndex = Map<string, GameObject>
type SlugIndex = Map<string, GameObject>

let objectIndex: ObjectIndex | null = null
let slugIndex: SlugIndex | null = null

const contentDir = (objectType: GameObjectType): string => {
  switch (objectType) {
    case 'character':
      return 'content/characters'
    case 'place':
      return 'content/places'
    case 'learning-goals':
      return 'content/learning-goals'
    case 'artifact':
      return 'content/artifacts'
  }
}

const yamlPathForSlug = (objectType: GameObjectType, slug: string): string => {
  if (objectType === 'character') {
    return path.resolve(workspaceRoot, contentDir(objectType), slug, 'character.yaml')
  }
  return path.resolve(workspaceRoot, contentDir(objectType), `${slug}.yaml`)
}

const readYamlFile = async (filePath: string): Promise<Record<string, unknown>> => {
  const raw = await readFile(filePath, 'utf8')
  return parseYaml(raw) as Record<string, unknown>
}

const loadCharacterSlugs = async (): Promise<string[]> => {
  const dir = path.resolve(workspaceRoot, contentDir('character'))
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

const loadFlatYamlSlugs = async (objectType: GameObjectType): Promise<string[]> => {
  const dir = path.resolve(workspaceRoot, contentDir(objectType))
  try {
    const entries = await readdir(dir)
    return entries
      .filter((name) => /\.ya?ml$/i.test(name))
      .map((name) => name.replace(/\.ya?ml$/i, ''))
  } catch {
    return []
  }
}

const validateParsed = (
  objectType: GameObjectType,
  parsed: unknown,
  slug: string,
  filePath: string,
): GameObject => {
  switch (objectType) {
    case 'character':
      return validateCharacter(parsed, slug, filePath)
    case 'place':
      return validatePlace(parsed, slug, filePath)
    case 'learning-goals':
      return validateLearningGoal(parsed, slug, filePath)
    case 'artifact':
      return validateArtifact(parsed, slug, filePath)
  }
}

const buildIndexes = async (): Promise<{ objects: ObjectIndex; slugs: SlugIndex }> => {
  const objects: ObjectIndex = new Map()
  const slugs: SlugIndex = new Map()

  const characterSlugs = await loadCharacterSlugs()
  for (const slug of characterSlugs) {
    try {
      const filePath = yamlPathForSlug('character', slug)
      const parsed = await readYamlFile(filePath)
      const obj = validateParsed('character', parsed, slug, filePath)
      objects.set(obj.id, obj)
      slugs.set(`character:${slug}`, obj)
    } catch {
      /* skip invalid */
    }
  }

  const flatTypes: GameObjectType[] = ['place', 'learning-goals', 'artifact']
  for (const objectType of flatTypes) {
    const typeSlugs = await loadFlatYamlSlugs(objectType)
    for (const slug of typeSlugs) {
      try {
        const filePath = yamlPathForSlug(objectType, slug)
        const parsed = await readYamlFile(filePath)
        const obj = validateParsed(objectType, parsed, slug, filePath)
        objects.set(obj.id, obj)
        slugs.set(`${objectType}:${slug}`, obj)
      } catch {
        /* skip invalid */
      }
    }
  }

  return { objects, slugs }
}

const ensureIndexes = async (): Promise<{ objects: ObjectIndex; slugs: SlugIndex }> => {
  if (objectIndex && slugIndex) {
    return { objects: objectIndex, slugs: slugIndex }
  }
  const result = await buildIndexes()
  objectIndex = result.objects
  slugIndex = result.slugs
  return result
}

export const invalidateCache = (): void => {
  objectIndex = null
  slugIndex = null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const get = async (id: string): Promise<GameObject | null> => {
  const { objects, slugs } = await ensureIndexes()

  const direct = objects.get(id)
  if (direct) return direct

  if (!UUID_RE.test(id)) {
    for (const objectType of ['character', 'place', 'learning-goals', 'artifact'] as GameObjectType[]) {
      const bySlug = slugs.get(`${objectType}:${id}`)
      if (bySlug) return bySlug
    }
  }

  return null
}

export const getBySlug = async (
  objectType: GameObjectType,
  slug: string,
): Promise<GameObject | null> => {
  const { slugs } = await ensureIndexes()
  return slugs.get(`${objectType}:${slug}`) ?? null
}

export const resolveYamlPathForGameObject = async (
  idOrSlug: string,
  expectedType?: GameObjectType,
): Promise<string | null> => {
  const normalized = idOrSlug.trim()
  if (!normalized) return null
  const gameObject = await get(normalized)
  if (!gameObject) return null
  if (expectedType && gameObject.type !== expectedType) return null
  return yamlPathForSlug(gameObject.type, gameObject.slug)
}

export const listByType = async (objectType: GameObjectType): Promise<GameObject[]> => {
  const { objects } = await ensureIndexes()
  return Array.from(objects.values()).filter((obj) => obj.type === objectType)
}

export const listAll = async (): Promise<GameObject[]> => {
  const { objects } = await ensureIndexes()
  return Array.from(objects.values())
}

export const resolveRef = async (ref: GameObjectRef): Promise<GameObject | null> => {
  return get(ref.id)
}

export const resolveRefs = async (
  refs: GameObjectRef[],
): Promise<Array<GameObject | null>> => {
  return Promise.all(refs.map((ref) => resolveRef(ref)))
}

export type CreateGameObjectInput = {
  type: GameObjectType
  slug: string
  data: Record<string, unknown>
}

export const create = async (input: CreateGameObjectInput): Promise<GameObject> => {
  const id = randomUUID()
  const yamlData = { id, type: input.type, ...input.data }

  const contentPath = yamlPathForSlug(input.type, input.slug)

  if (input.type === 'character') {
    await mkdir(path.dirname(contentPath), { recursive: true })
  }

  const yamlContent = stringifyYaml(yamlData)
  await writeFile(contentPath, yamlContent, 'utf8')

  invalidateCache()

  const parsed = parseYaml(yamlContent) as Record<string, unknown>
  return validateParsed(input.type, parsed, input.slug, contentPath)
}

export type UpdateGameObjectInput = {
  patch: Record<string, unknown>
}

export const update = async (
  id: string,
  input: UpdateGameObjectInput,
): Promise<GameObject | null> => {
  const existing = await get(id)
  if (!existing) return null

  const contentPath = yamlPathForSlug(existing.type, existing.slug)

  const currentRaw = await readYamlFile(contentPath)
  const merged = { ...currentRaw, ...input.patch, id: existing.id, type: existing.type }
  const yamlContent = stringifyYaml(merged)

  await writeFile(contentPath, yamlContent, 'utf8')

  invalidateCache()

  const parsed = parseYaml(yamlContent) as Record<string, unknown>
  return validateParsed(existing.type, parsed, existing.slug, contentPath)
}

export const remove = async (id: string): Promise<boolean> => {
  const existing = await get(id)
  if (!existing) return false

  const contentPath = yamlPathForSlug(existing.type, existing.slug)

  if (existing.type === 'character') {
    await rm(path.dirname(contentPath), { recursive: true, force: true })
  } else {
    await rm(contentPath, { force: true })
  }

  invalidateCache()
  return true
}

export const getContext = async (
  id: string,
): Promise<{ id: string; name: string; type: GameObjectType; slug: string } | null> => {
  const obj = await get(id)
  if (!obj) return null
  return { id: obj.id, name: obj.name, type: obj.type, slug: obj.slug }
}

export const getContextBatch = async (
  ids: string[],
): Promise<Array<{ id: string; name: string; type: GameObjectType; slug: string }>> => {
  const results = await Promise.all(ids.map((id) => getContext(id)))
  return results.filter(
    (result): result is { id: string; name: string; type: GameObjectType; slug: string } =>
      result !== null,
  )
}
