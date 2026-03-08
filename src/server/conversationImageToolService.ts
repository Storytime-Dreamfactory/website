import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { FluxClient } from '../../tools/character-image-service/src/fluxClient.ts'
import { appendConversationMessage } from './conversationStore.ts'
import { createActivity } from './activityStore.ts'
import {
  CHARACTER_AGENT_TOOLS,
  getCharacterAgentSkillPlaybook,
} from './characterAgentDefinitions.ts'
import { storeConversationImageAsset } from './conversationImageAssetStore.ts'
import {
  buildCharacterInteractionTargets,
  buildInteractionMetadata,
  parseInteractionTargets,
} from './activityInteractionMetadata.ts'
import {
  collateRelatedCharacterObjects,
  resolveCharacterImageRefs,
  selectImageReferencesForPrompt,
} from './runtime/context/contextCollationService.ts'
import { trackTraceActivitySafely } from './traceActivity.ts'

type CharacterYaml = {
  id?: string
  name?: string
  kurzbeschreibung?: string
  basis?: {
    species?: string
  }
  erscheinung?: {
    colors?: string[]
    distinctive_features?: string[]
  }
}

type GenerateConversationHeroToolInput = {
  conversationId: string
  characterId: string
  scenePrompt: string
  styleHint?: string
  interactionTargets?: unknown
  relatedCharacterIds?: unknown
  relatedCharacterNames?: unknown
  forceReferenceImagePaths?: unknown
  width?: unknown
  height?: unknown
  pollIntervalMs?: unknown
  maxPollAttempts?: unknown
  seed?: unknown
}

export type GenerateConversationHeroToolResult = {
  requestId: string
  imageUrl: string
  heroImageUrl: string
  summary: string
  model: string
  width: number
  height: number
  seed: number
  cost?: number
}

export class ConversationImageToolApiError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'ConversationImageToolApiError'
    this.statusCode = statusCode
  }
}

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const DEFAULT_WIDTH = 1536
const DEFAULT_HEIGHT = 1152
const DEFAULT_POLL_INTERVAL_MS = 800
const DEFAULT_MAX_POLL_ATTEMPTS = 90
const VISUAL_EXPRESSION_SKILL = getCharacterAgentSkillPlaybook('visual-expression')

const summarizeScene = (scenePrompt: string): string => {
  const compact = scenePrompt.replace(/\s+/g, ' ').trim()
  if (compact.length <= 180) return compact
  return `${compact.slice(0, 177)}...`
}

const buildImageGeneratedSummary = (characterName: string, scenePrompt: string): string =>
  `${characterName} zeigt ein neues Bild: ${summarizeScene(scenePrompt)}`

const clampDimension = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(768, Math.min(2048, Math.floor(value)))
}

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const readTextArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

const trackImageActivitySafely = async (input: {
  activityType: string
  isPublic: boolean
  characterId: string
  characterName: string
  conversationId: string
  imageUrl?: string
  metadata?: Record<string, unknown>
}): Promise<void> => {
  try {
    await createActivity({
      activityType: input.activityType,
      isPublic: input.isPublic,
      characterId: input.characterId,
      conversationId: input.conversationId,
      subject: {
        type: 'character',
        id: input.characterId,
        name: input.characterName,
      },
      object: input.imageUrl
        ? { type: 'image', url: input.imageUrl, format: 'hero' }
        : { type: 'tool', id: 'conversation-image' },
      metadata: input.metadata,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Conversation image activity tracking failed: ${message}`)
  }
}

const loadCharacterYaml = async (characterId: string): Promise<CharacterYaml | null> => {
  const yamlPath = path.resolve(workspaceRoot, 'content/characters', characterId, 'character.yaml')
  try {
    const raw = await readFile(yamlPath, 'utf8')
    return parseYaml(raw) as CharacterYaml
  } catch {
    return null
  }
}

const takeTop = (input: string[] | undefined, limit: number): string =>
  Array.isArray(input)
    ? input
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .slice(0, limit)
        .join(', ')
    : ''

const buildHeroPrompt = (
  characterId: string,
  scenePrompt: string,
  styleHint: string,
  yaml: CharacterYaml | null,
): string => {
  const name = yaml?.name?.trim() || characterId
  const species = yaml?.basis?.species?.trim() || 'Figur'
  const shortDescription = yaml?.kurzbeschreibung?.trim() || ''
  const colors = takeTop(yaml?.erscheinung?.colors, 4)
  const features = takeTop(yaml?.erscheinung?.distinctive_features, 4)

  const styleLine = styleHint
    ? `Stilhinweis fuer diese Szene: ${styleHint}.`
    : 'Stilhinweis fuer diese Szene: warm, maerchenhaft, kindgerecht, klar lesbare Formen.'

  return [
    'Hero-Hintergrund im Storytime-Stil, Querformat 4:3, fuer Vollbild-Background.',
    `Motiv: ${name} (${species}) zeigt waehrend eines Gespraechs aktiv eine Szene.`,
    shortDescription ? `Charakterkontext: ${shortDescription}` : '',
    colors ? `Wichtige Farben: ${colors}.` : '',
    features ? `Wichtige Merkmale: ${features}.` : '',
    `Szene, die gezeigt werden soll: ${scenePrompt}.`,
    styleLine,
    'Softe cinematic Beleuchtung, hohe Lesbarkeit, keine Logos, keine Schrift, kein UI, kein Text.',
    'Keine fotorealistische, keine horrorartige, keine sexualisierte oder brutale Darstellung.',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

export const generateConversationHeroToolApi = async (
  input: GenerateConversationHeroToolInput,
): Promise<GenerateConversationHeroToolResult> => {
  await trackTraceActivitySafely({
    activityType: 'trace.tool.generate_conversation_hero.request',
    summary: 'generate_conversation_hero gestartet',
    conversationId: input.conversationId,
    characterId: input.characterId,
    characterName: input.characterId,
    traceStage: 'tool',
    traceKind: 'request',
    traceSource: 'api',
    input: {
      scenePrompt: input.scenePrompt?.slice(0, 240),
      styleHint: input.styleHint?.slice(0, 120),
    },
  })
  const apiKey = process.env.BFL_API_KEY?.trim()
  if (!apiKey) {
    throw new ConversationImageToolApiError(
      'BFL_API_KEY fehlt. Bitte setze den FLUX API Key in der Umgebung.',
      400,
    )
  }

  const conversationId = readText(input.conversationId)
  const characterId = readText(input.characterId)
  const scenePrompt = readText(input.scenePrompt)
  const styleHint = readText(input.styleHint)
  const providedInteractionTargets = parseInteractionTargets(input.interactionTargets)
  const relatedCharacterIds = readTextArray(input.relatedCharacterIds)
  const relatedCharacterNames = readTextArray(input.relatedCharacterNames)
  const forceReferenceImagePaths = readTextArray(input.forceReferenceImagePaths)
  const implicitCharacterTargets = buildCharacterInteractionTargets(
    relatedCharacterIds.map((relatedCharacterId, index) => ({
      characterId: relatedCharacterId,
      name: relatedCharacterNames[index],
    })),
  )
  const interactionTargets = [...providedInteractionTargets, ...implicitCharacterTargets].filter(
    (target, index, allTargets) =>
      allTargets.findIndex(
        (candidate) => candidate.type === target.type && candidate.id === target.id,
      ) === index,
  )

  if (!conversationId) throw new ConversationImageToolApiError('conversationId ist erforderlich.', 400)
  if (!characterId) throw new ConversationImageToolApiError('characterId ist erforderlich.', 400)
  if (!scenePrompt) throw new ConversationImageToolApiError('scenePrompt ist erforderlich.', 400)

  const width = clampDimension(input.width, DEFAULT_WIDTH)
  const height = clampDimension(input.height, DEFAULT_HEIGHT)
  const pollIntervalMs = clampInteger(input.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 200, 10_000)
  const maxPollAttempts = clampInteger(input.maxPollAttempts, DEFAULT_MAX_POLL_ATTEMPTS, 10, 300)
  const model = 'flux-2-flex'
  const seed =
    typeof input.seed === 'number' && Number.isFinite(input.seed)
      ? Math.floor(input.seed)
      : Math.floor(Math.random() * 2_147_483_647)

  const characterYaml = await loadCharacterYaml(characterId)
  const prompt = buildHeroPrompt(characterId, scenePrompt, styleHint, characterYaml)
  const characterName = characterYaml?.name?.trim() || characterId
  const interactionMetadata = buildInteractionMetadata(characterId, interactionTargets)
  const relatedCharacterLinks = interactionTargets
    .filter((target) => target.type === 'character')
    .map((target) => ({
      relatedCharacterId: target.id,
      direction: 'outgoing' as const,
      relationshipType: 'interaction_target',
      relationshipTypeReadable: 'Interaction Target',
      relationship: 'interaction_target',
      otherRelatedObjects: [] as Array<{
        type: string
        id: string
        label?: string
        metadata?: Record<string, unknown>
      }>,
    }))
  const relatedObjects = await collateRelatedCharacterObjects({
    relatedCharacterIds: relatedCharacterLinks.map((item) => item.relatedCharacterId),
    relationshipLinks: relatedCharacterLinks,
  })
  const selectedReferences = await selectImageReferencesForPrompt({
    scenePrompt,
    lastUserText: scenePrompt,
    relatedObjects,
    maxRelatedReferences: 5,
  })
  const primaryImageRefs = await resolveCharacterImageRefs(characterId)
  const primaryReferencePath = primaryImageRefs[0]?.path
  const referenceImagePaths = [
    primaryReferencePath,
    ...forceReferenceImagePaths,
    ...selectedReferences.selectedReferences.map((item) => item.imagePath),
  ]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => path.resolve(workspaceRoot, 'public', item.replace(/^\/+/, '')))
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 6)
  const client = new FluxClient(apiKey)

  try {
    await trackImageActivitySafely({
      activityType: 'skill.visual-expression.started',
      isPublic: false,
      characterId,
      characterName,
      conversationId,
      metadata: {
        summary: `${characterName} startet visuelles Erklaeren`,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        scenePrompt,
        ...interactionMetadata,
      },
    })
    await trackImageActivitySafely({
      activityType: 'tool.image.planning.started',
      isPublic: false,
      characterId,
      characterName,
      conversationId,
      metadata: {
        summary: `${characterName} plant ein Bild`,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolId: CHARACTER_AGENT_TOOLS.generateImage,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        scenePrompt,
        styleHint: styleHint || undefined,
        ...interactionMetadata,
      },
    })

    const requestResult =
      referenceImagePaths.length > 0
        ? await client.editImage({
            model,
            prompt,
            width,
            height,
            outputFormat: 'jpeg',
            seed,
            referenceImagePaths,
          })
        : await client.generateTextToImage({
            model,
            prompt,
            width,
            height,
            outputFormat: 'jpeg',
            seed,
          })
    await trackImageActivitySafely({
      activityType: 'tool.image.requested',
      isPublic: false,
      characterId,
      characterName,
      conversationId,
      metadata: {
        summary: `${characterName} hat die Bildgenerierung gestartet`,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolId: CHARACTER_AGENT_TOOLS.generateImage,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        requestId: requestResult.id,
        scenePrompt,
        imageGenerationPrompt: prompt,
        model,
        styleMode: referenceImagePaths.length > 0 ? 'hero-reference-image-edit' : 'text-only-fallback',
        selectedReferences: selectedReferences.selectedReferences,
        ...interactionMetadata,
      },
    })
    await trackImageActivitySafely({
      activityType: 'tool.image.generating',
      isPublic: false,
      characterId,
      characterName,
      conversationId,
      metadata: {
        summary: `${characterName} erstellt gerade ein Bild`,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolId: CHARACTER_AGENT_TOOLS.generateImage,
        requestId: requestResult.id,
        ...interactionMetadata,
      },
    })
    const pollResult = await client.pollResult({
      pollingUrl: requestResult.polling_url,
      pollIntervalMs,
      maxAttempts: maxPollAttempts,
    })

    if (pollResult.status !== 'Ready') {
      const errorMessage = 'error' in pollResult ? pollResult.error : undefined
      await trackImageActivitySafely({
        activityType: 'tool.image.failed',
        isPublic: false,
        characterId,
        characterName,
        conversationId,
        metadata: {
          summary: `${characterName} konnte das Bild nicht fertigstellen`,
          skillId: VISUAL_EXPRESSION_SKILL?.id,
          toolId: CHARACTER_AGENT_TOOLS.generateImage,
          requestId: requestResult.id,
          status: pollResult.status,
          reason: errorMessage ?? pollResult.status,
        },
      })
      throw new ConversationImageToolApiError(
        errorMessage ?? 'FLUX konnte kein Hero-Bild erzeugen.',
        502,
      )
    }

    const remoteImageUrl = pollResult.result.sample
    const storedImage = await storeConversationImageAsset({
      conversationId,
      imageUrl: remoteImageUrl,
      requestId: requestResult.id,
      prefix: 'tool',
    })
    if (!storedImage?.localUrl) {
      await trackImageActivitySafely({
        activityType: 'tool.image.failed',
        isPublic: false,
        characterId,
        characterName,
        conversationId,
        metadata: {
          summary: `${characterName} konnte das Bild nicht lokal speichern`,
          skillId: VISUAL_EXPRESSION_SKILL?.id,
          toolId: CHARACTER_AGENT_TOOLS.generateImage,
          requestId: requestResult.id,
          reason: 'local-asset-store-failed',
          originalImageUrl: remoteImageUrl,
        },
      })
      throw new ConversationImageToolApiError(
        'Bild wurde erzeugt, konnte aber nicht lokal gespeichert werden.',
        502,
      )
    }

    const imageUrl = storedImage.localUrl
    const summary = buildImageGeneratedSummary(characterName, scenePrompt)

    await appendConversationMessage({
      conversationId,
      role: 'system',
      content: summary,
      eventType: 'tool.image.generated',
      metadata: {
        imageUrl,
        heroImageUrl: imageUrl,
        originalImageUrl: remoteImageUrl,
        imageAssetPath: storedImage?.localFilePath,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        prompt,
        scenePrompt,
        styleHint: styleHint || undefined,
        model,
        width,
        height,
        seed,
        requestId: requestResult.id,
        styleMode: referenceImagePaths.length > 0 ? 'hero-reference-image-edit' : 'text-only-fallback',
        selectedReferences: selectedReferences.selectedReferences,
        ...interactionMetadata,
      },
    })

    await trackImageActivitySafely({
      activityType: 'tool.image.generated',
      isPublic: false,
      characterId,
      characterName,
      conversationId,
      imageUrl,
      metadata: {
        summary: `${characterName} hat ein Bild fertiggestellt`,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolId: CHARACTER_AGENT_TOOLS.showImage,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        requestId: requestResult.id,
        scenePrompt,
        styleMode: referenceImagePaths.length > 0 ? 'hero-reference-image-edit' : 'text-only-fallback',
        selectedReferences: selectedReferences.selectedReferences,
        ...interactionMetadata,
      },
    })

    await trackImageActivitySafely({
      activityType: 'skill.visual-expression.completed',
      isPublic: false,
      characterId,
      characterName,
      conversationId,
      imageUrl,
      metadata: {
        summary: `${characterName} hat visuelles Erklaeren abgeschlossen`,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        scenePrompt,
        ...interactionMetadata,
      },
    })

    await trackImageActivitySafely({
      activityType: 'conversation.image.generated',
      isPublic: true,
      characterId,
      characterName,
      conversationId,
      imageUrl,
      metadata: {
        summary,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        conversationLinkLabel: 'Conversation ansehen',
        heroImageUrl: imageUrl,
        imageUrl,
        originalImageUrl: remoteImageUrl,
        imageAssetPath: storedImage?.localFilePath,
        scenePrompt,
        model,
        width,
        height,
        requestId: requestResult.id,
        seed,
        styleMode: referenceImagePaths.length > 0 ? 'hero-reference-image-edit' : 'text-only-fallback',
        selectedReferences: selectedReferences.selectedReferences,
        ...interactionMetadata,
      },
    })

    const result = {
      requestId: requestResult.id,
      imageUrl,
      heroImageUrl: imageUrl,
      summary,
      model,
      width,
      height,
      seed,
      cost: requestResult.cost,
    }
    await trackTraceActivitySafely({
      activityType: 'trace.tool.generate_conversation_hero.response',
      summary: 'generate_conversation_hero erfolgreich',
      conversationId,
      characterId,
      characterName,
      traceStage: 'tool',
      traceKind: 'response',
      traceSource: 'api',
      output: {
        requestId: result.requestId,
        imageUrl: result.imageUrl,
      },
      ok: true,
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await trackImageActivitySafely({
      activityType: 'tool.image.failed',
      isPublic: false,
      characterId,
      characterName,
      conversationId,
      metadata: {
        summary: `${characterName} konnte das Bild nicht erstellen`,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolId: CHARACTER_AGENT_TOOLS.generateImage,
        scenePrompt,
        reason: message,
      },
    })
    if (error instanceof ConversationImageToolApiError) {
      await trackTraceActivitySafely({
        activityType: 'trace.tool.generate_conversation_hero.error',
        summary: 'generate_conversation_hero fehlgeschlagen',
        conversationId: input.conversationId,
        characterId: input.characterId,
        characterName: input.characterId,
        traceStage: 'tool',
        traceKind: 'error',
        traceSource: 'api',
        ok: false,
        error: message,
      })
      throw error
    }
    await trackTraceActivitySafely({
      activityType: 'trace.tool.generate_conversation_hero.error',
      summary: 'generate_conversation_hero fehlgeschlagen',
      conversationId: input.conversationId,
      characterId: input.characterId,
      characterName: input.characterId,
      traceStage: 'tool',
      traceKind: 'error',
      traceSource: 'api',
      ok: false,
      error: message,
    })
    throw new ConversationImageToolApiError(message, 500)
  }
}
