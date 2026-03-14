import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { getOpenAiApiKey, readServerEnv } from '../../openAiConfig.ts'
import { listActivities } from '../../activityStore.ts'
import { get as getGameObject, resolveYamlPathForGameObject } from '../../gameObjectService.ts'
import { listRelationshipsForCharacter } from '../../relationshipStore.ts'
import { loadCharacterRuntimeProfiles } from '../../runtimeContentStore.ts'

export type CollatedRelationshipLink = {
  relatedCharacterId: string
  direction: 'outgoing' | 'incoming'
  relationshipType: string
  relationshipTypeReadable: string
  relationship: string
  description?: string
  metadata?: Record<string, unknown>
}

export type CollatedImageRef = {
  kind: 'hero' | 'standard' | 'portrait' | 'profile'
  title: string
  path: string
}

export type CollatedRelatedObject = {
  objectType: string
  objectId: string
  displayName: string
  species?: string
  shortDescription?: string
  relationshipLinks: CollatedRelationshipLink[]
  imageRefs: CollatedImageRef[]
  evidence: string[]
}

export type CollatedActivityContext = {
  activityType: string
  occurredAt: string
  summary?: string
}

export type CollatedContext = {
  conversationId: string
  characterId: string
  relatedObjects: CollatedRelatedObject[]
  activities: CollatedActivityContext[]
}

export type SelectedImageReference = {
  objectType: string
  objectId: string
  title: string
  imagePath: string
  reason: string
}

export type ImageReferenceSelectionResult = {
  selectedReferences: SelectedImageReference[]
}

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const REFERENCE_SELECTOR_MODEL = readServerEnv('RUNTIME_REFERENCE_SELECTOR_MODEL', 'gpt-5.4')

type CharacterYaml = {
  name?: string
  bilder?: {
    hero_image?: { datei?: string }
    standard_figur?: { datei?: string }
    portrait?: { datei?: string }
    profilbild?: { datei?: string }
  }
}

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

const toWorkspacePublicPath = (publicUrlPath: string): string =>
  path.resolve(workspaceRoot, 'public', publicUrlPath.replace(/^\/+/, ''))

const toPublicUrl = (absolutePath: string): string => {
  const publicRoot = path.resolve(workspaceRoot, 'public')
  const relative = path.relative(publicRoot, absolutePath).replaceAll(path.sep, '/')
  return relative.startsWith('..') ? absolutePath : `/${relative}`
}

const pickPreferredImageRef = (imageRefs: CollatedImageRef[]): CollatedImageRef | undefined =>
  imageRefs.find((item) => item.kind === 'standard') ??
  imageRefs.find((item) => item.kind === 'portrait') ??
  imageRefs.find((item) => item.kind === 'hero') ??
  imageRefs.find((item) => item.kind === 'profile')

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const collectExistingImageRef = async (
  kind: CollatedImageRef['kind'],
  title: string,
  candidates: string[],
): Promise<CollatedImageRef | null> => {
  for (const candidate of candidates) {
    if (!candidate) continue
    const absolutePath = toWorkspacePublicPath(candidate)
    if (await exists(absolutePath)) {
      return {
        kind,
        title,
        path: toPublicUrl(absolutePath),
      }
    }
  }
  return null
}

export const resolveCharacterImageRefs = async (characterId: string): Promise<CollatedImageRef[]> => {
  const normalizedId = characterId.trim()
  if (!normalizedId) return []
  const gameObject = await getGameObject(normalizedId)
  const characterFolder = gameObject?.type === 'character' ? gameObject.id : normalizedId
  let yaml: CharacterYaml | null = null
  try {
    const yamlPath = await resolveYamlPathForGameObject(normalizedId, 'character')
    if (!yamlPath) return []
    const raw = await readFile(yamlPath, 'utf8')
    yaml = parseYaml(raw) as CharacterYaml
  } catch {
    yaml = null
  }

  const heroRef = await collectExistingImageRef('hero', 'Hero', [
    readText(yaml?.bilder?.hero_image?.datei),
    `/content/characters/${characterFolder}/hero-image.jpg`,
    `/content/characters/${characterFolder}/hero-image.png`,
    `/content/characters/${characterFolder}/hero-image.jpeg`,
    `/content/characters/${characterFolder}/hero-image.webp`,
  ])
  const standardRef = await collectExistingImageRef('standard', 'Standard', [
    readText(yaml?.bilder?.standard_figur?.datei),
    `/content/characters/${characterFolder}/standard-figur.png`,
    `/content/characters/${characterFolder}/standard-figur.jpg`,
    `/content/characters/${characterFolder}/standard-figur.jpeg`,
    `/content/characters/${characterFolder}/standard-figur.webp`,
  ])
  const portraitRef = await collectExistingImageRef('portrait', 'Portrait', [
    readText(yaml?.bilder?.portrait?.datei),
    `/content/characters/${characterFolder}/portrait.png`,
    `/content/characters/${characterFolder}/portrait.jpg`,
    `/content/characters/${characterFolder}/portrait.jpeg`,
    `/content/characters/${characterFolder}/portrait.webp`,
  ])
  const profileRef = await collectExistingImageRef('profile', 'Profilbild', [
    readText(yaml?.bilder?.profilbild?.datei),
    `/content/characters/${characterFolder}/profilbild.png`,
    `/content/characters/${characterFolder}/profilbild.jpg`,
    `/content/characters/${characterFolder}/profilbild.jpeg`,
    `/content/characters/${characterFolder}/profilbild.webp`,
  ])

  return [heroRef, standardRef, portraitRef, profileRef].filter(
    (item): item is CollatedImageRef => item !== null,
  )
}

export const collateRelatedCharacterObjects = async (input: {
  relatedCharacterIds: string[]
  relationshipLinks?: CollatedRelationshipLink[]
  evidenceByCharacterId?: Record<string, string[]>
}): Promise<CollatedRelatedObject[]> => {
  const ids = Array.from(
    new Set(
      input.relatedCharacterIds
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  )
  if (ids.length === 0) return []

  const profiles = await loadCharacterRuntimeProfiles(ids)
  const linksByCharacterId = new Map<string, CollatedRelationshipLink[]>()
  for (const link of input.relationshipLinks ?? []) {
    const id = link.relatedCharacterId.trim()
    if (!id) continue
    const current = linksByCharacterId.get(id) ?? []
    current.push(link)
    linksByCharacterId.set(id, current)
  }

  const imageRefsByCharacterId = new Map<string, CollatedImageRef[]>()
  await Promise.all(
    ids.map(async (id) => {
      imageRefsByCharacterId.set(id, await resolveCharacterImageRefs(id))
    }),
  )

  return profiles.map((profile) => ({
    objectType: 'character',
    objectId: profile.id,
    displayName: profile.name,
    species: profile.species || undefined,
    shortDescription: profile.shortDescription || undefined,
    relationshipLinks: linksByCharacterId.get(profile.id) ?? [],
    imageRefs: imageRefsByCharacterId.get(profile.id) ?? [],
    evidence: input.evidenceByCharacterId?.[profile.id] ?? [],
  }))
}

const buildFallbackSelection = (input: {
  scenePrompt: string
  lastUserText: string
  relatedObjects: CollatedRelatedObject[]
  maxRelatedReferences: number
}): ImageReferenceSelectionResult => {
  const haystack = normalizeText(`${input.scenePrompt} ${input.lastUserText}`)
  const scored = input.relatedObjects
    .map((item) => {
      const title = normalizeText(item.displayName)
      const id = normalizeText(item.objectId)
      const relationshipTokens = item.relationshipLinks
        .flatMap((link) => [
          normalizeText(link.relationshipTypeReadable),
          normalizeText(link.relationshipType),
          normalizeText(link.relationship),
        ])
        .filter((token) => token.length > 1)
      let score = 0
      if (title && haystack.includes(title)) score += 5
      if (id && haystack.includes(id)) score += 4
      if (relationshipTokens.some((token) => haystack.includes(token))) score += 2
      if (item.relationshipLinks.some((link) => normalizeText(link.relationshipType).includes('freund'))) {
        score += 1
      }
      const preferredImage = pickPreferredImageRef(item.imageRefs)
      return {
        item,
        score,
        preferredImage,
      }
    })
    .filter((entry) => entry.preferredImage)
    .sort((a, b) => b.score - a.score)

  const selectedReferences = scored.slice(0, input.maxRelatedReferences).map((entry) => ({
    objectType: entry.item.objectType,
    objectId: entry.item.objectId,
    title: entry.item.displayName,
    imagePath: entry.preferredImage?.path ?? '',
    reason:
      entry.score > 0
        ? 'Name/Beziehung passt zum Bildprompt.'
        : 'Naehester Beziehungskontext als visueller Anker.',
  }))

  return {
    selectedReferences: selectedReferences.filter((item) => item.imagePath.length > 0),
  }
}

const requestReferenceSelectionFromLlm = async (input: {
  scenePrompt: string
  lastUserText: string
  relatedObjects: CollatedRelatedObject[]
  maxRelatedReferences: number
}): Promise<ImageReferenceSelectionResult | null> => {
  if (process.env.NODE_ENV === 'test') return null
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return null

  const candidates = input.relatedObjects
    .map((item) => ({
      objectType: item.objectType,
      objectId: item.objectId,
      title: item.displayName,
      relationships: item.relationshipLinks.map((link) => link.relationshipTypeReadable || link.relationshipType),
      imagePath: pickPreferredImageRef(item.imageRefs)?.path ?? '',
    }))
    .filter((item) => item.imagePath.length > 0)
  if (candidates.length === 0) return { selectedReferences: [] }

  const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: REFERENCE_SELECTOR_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Waehle fuer eine Bildszene die relevantesten Referenzfiguren aus. Gib nur JSON zurueck.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            scenePrompt: input.scenePrompt,
            lastUserText: input.lastUserText,
            maxRelatedReferences: input.maxRelatedReferences,
            candidates,
          }),
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'image_reference_selection',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              selectedReferences: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    objectType: { type: 'string' },
                    objectId: { type: 'string' },
                    title: { type: 'string' },
                    imagePath: { type: 'string' },
                    reason: { type: 'string' },
                  },
                  required: ['objectType', 'objectId', 'title', 'imagePath', 'reason'],
                },
              },
            },
            required: ['selectedReferences'],
          },
        },
      },
    }),
  })
  if (!response.ok) return null
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = body?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return null
  try {
    const parsed = JSON.parse(content) as ImageReferenceSelectionResult
    const selectedReferences = Array.isArray(parsed.selectedReferences)
      ? parsed.selectedReferences
          .filter((item) => item && typeof item.imagePath === 'string' && item.imagePath.trim().length > 0)
          .slice(0, input.maxRelatedReferences)
      : []
    return { selectedReferences }
  } catch {
    return null
  }
}

export const selectImageReferencesForPrompt = async (input: {
  scenePrompt: string
  lastUserText: string
  relatedObjects: CollatedRelatedObject[]
  maxRelatedReferences?: number
}): Promise<ImageReferenceSelectionResult> => {
  const maxRelatedReferences = Math.max(1, Math.min(6, Math.floor(input.maxRelatedReferences ?? 3)))
  const llmSelection = await requestReferenceSelectionFromLlm({
    scenePrompt: input.scenePrompt,
    lastUserText: input.lastUserText,
    relatedObjects: input.relatedObjects,
    maxRelatedReferences,
  })
  if (llmSelection) return llmSelection
  return buildFallbackSelection({
    scenePrompt: input.scenePrompt,
    lastUserText: input.lastUserText,
    relatedObjects: input.relatedObjects,
    maxRelatedReferences,
  })
}

export const collateContextForConversation = async (input: {
  conversationId: string
  characterId: string
  activityLimit?: number
}): Promise<CollatedContext> => {
  const relationships = await listRelationshipsForCharacter(input.characterId)
  const relationshipLinks: CollatedRelationshipLink[] = relationships.map((relationship) => ({
    relatedCharacterId:
      relationship.direction === 'outgoing'
        ? relationship.targetCharacterId
        : relationship.sourceCharacterId,
    direction: relationship.direction,
    relationshipType: relationship.relationshipType,
    relationshipTypeReadable: relationship.relationshipTypeReadable,
    relationship: relationship.relationship,
    description: relationship.description,
    metadata: relationship.metadata,
  }))
  const relatedCharacterIds = relationshipLinks.map((link) => link.relatedCharacterId)
  const relatedObjects = await collateRelatedCharacterObjects({
    relatedCharacterIds,
    relationshipLinks,
  })
  const activities = await listActivities({
    conversationId: input.conversationId,
    limit: input.activityLimit ?? 12,
    isPublic: undefined,
  })
  return {
    conversationId: input.conversationId,
    characterId: input.characterId,
    relatedObjects,
    activities: activities.map((activity) => ({
      activityType: activity.activityType,
      occurredAt: activity.occurredAt,
      summary: readText(activity.metadata.summary) || undefined,
    })),
  }
}
