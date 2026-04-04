import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { appendConversationMessage } from './conversationStore.ts'
import { createActivity } from './activityStore.ts'
import { generateImageWithModel, resolveDefaultConversationImageModel } from './imageGenerationService.ts'
import { parseSupportedImageModel } from './imageModelSupport.ts'
import { getOpenAiApiKey } from './openAiConfig.ts'
import {
  CHARACTER_AGENT_TOOLS,
  getCharacterAgentSkillPlaybook,
} from './characterAgentDefinitions.ts'
import { storeConversationImageAsset } from './conversationImageAssetStore.ts'
import { resolveYamlPathForGameObject } from './gameObjectService.ts'
import {
  buildCharacterInteractionTargets,
  buildInteractionMetadata,
  parseInteractionTargets,
} from './activityInteractionMetadata.ts'
import {
  resolveCharacterImageRefs,
} from './runtime/context/contextCollationService.ts'
import { trackTraceActivitySafely } from './traceActivity.ts'
import type { SupportedImageModel } from './imageModelSupport.ts'

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
  sceneSummary?: string
  imagePrompt?: string
  scenePrompt?: string
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
  model?: unknown
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

const joinCharacterNames = (names: string[]): string => {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} und ${names[1]}`
  return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`
}

const buildImageGeneratedSummary = (
  characterName: string,
  sceneSummary: string,
  imageVisualSummary: string,
  relatedCharacterNames: string[],
): string => {
  const canonicalSummary = sceneSummary.trim()
  if (canonicalSummary) return canonicalSummary
  const narration = imageVisualSummary.trim()
  const companions = joinCharacterNames(
    Array.from(new Set(relatedCharacterNames.map((item) => item.trim()).filter(Boolean))),
  )
  const actorLine = companions ? `${characterName} mit ${companions}` : characterName
  if (narration) return `${actorLine} zeigte eine neue Szene: ${narration}`
  return `${actorLine} zeigte eine neue Szene.`
}

const buildInternalImageGeneratedSummary = (characterName: string): string => {
  return `${characterName} hat die Bildgenerierung abgeschlossen.`
}

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

const describeImageWithFastModel = async (input: {
  imageUrl: string
  sceneSummary?: string
  fallbackText?: string
}): Promise<string> => {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) return ''
  const imageUrl = input.imageUrl.trim()
  if (!imageUrl) return ''
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5.4',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: [
                  'Beschreibe dieses Bild in genau 1-2 kurzen deutschen Saetzen fuer ein Kind.',
                  'Nenne nur sichtbare Inhalte (Figuren, Handlung, Umgebung, Stimmung, Farben).',
                  'Keine Vermutungen, keine Meta-Erklaerung, keine Aufzaehlung.',
                  input.sceneSummary
                    ? `Szenenkontext (optional): ${input.sceneSummary}`
                    : input.fallbackText
                      ? `Zusatzkontext (optional): ${input.fallbackText}`
                      : '',
                ]
                  .filter((line) => line.length > 0)
                  .join('\n'),
              },
              {
                type: 'input_image',
                image_url: imageUrl,
              },
            ],
          },
        ],
        max_output_tokens: 120,
      }),
    })
    if (!response.ok) return ''
    const data = (await response.json()) as {
      output_text?: string
      output?: Array<{
        content?: Array<{ type?: string; text?: string }>
      }>
    }
    const directText = typeof data.output_text === 'string' ? data.output_text.trim() : ''
    if (directText) return directText
    const nestedText = data.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === 'output_text' && typeof item.text === 'string')
      ?.text?.trim()
    return nestedText ?? ''
  } catch {
    return ''
  }
}

const trackImageActivitySafely = async (input: {
  activityType: string
  isPublic: boolean
  characterId: string
  characterName: string
  conversationId: string
  imageUrl?: string
  storySummary?: string
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
      storySummary: input.storySummary,
      metadata: input.metadata,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Conversation image activity tracking failed: ${message}`)
  }
}

const loadCharacterYaml = async (characterId: string): Promise<CharacterYaml | null> => {
  try {
    const yamlPath = await resolveYamlPathForGameObject(characterId, 'character')
    if (!yamlPath) return null
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

const resolveReferenceStyleMode = (input: {
  latestConversationReferenceCount: number
  identityReferenceCount: number
}): 'scene-reference-edit' | 'identity-reference-grounded' | 'text-only-fallback' => {
  if (input.latestConversationReferenceCount > 0) return 'scene-reference-edit'
  if (input.identityReferenceCount > 0) return 'identity-reference-grounded'
  return 'text-only-fallback'
}

const buildHeroPrompt = (
  characterId: string,
  sceneSummary: string,
  imagePrompt: string,
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
    'PRIORITAET 1: Rendere die neue Szene aus Scene Summary und Image Prompt klar, sichtbar und eindeutig.',
    'PRIORITAET 2: Halte Charakteridentitaet, sichtbare Merkmale und wichtige Farben stabil.',
    'PRIORITAET 3: Nutze fruehere Szenenbilder nur als Kontinuitaetshilfe fuer Ort, Licht, Farben und Raumlogik, niemals als Vorgabe fuer eine fast identische Wiederholung.',
    sceneSummary ? `VERBINDLICHE SZENENBESCHREIBUNG: ${sceneSummary}.` : '',
    `HAUPTFIGUR: ${name} (${species}).`,
    shortDescription ? `Charakterkontext: ${shortDescription}` : '',
    colors ? `Wichtige Farben: ${colors}.` : '',
    features ? `Wichtige Merkmale: ${features}.` : '',
    '',
    imagePrompt,
    '',
    'Wenn die neue Szene einen Orts-, Positions- oder Fokuswechsel beschreibt, muss dieser Wechsel in der Komposition sofort lesbar sein.',
    'Kontinuitaet ist wichtig, aber die neue Szene darf nicht wie eine unveraenderte Kopie der letzten Einstellung wirken.',
    'Die Hauptaktion muss auf den ersten Blick lesbar sein.',
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
      imagePrompt: input.imagePrompt ?? input.scenePrompt,
      sceneSummary: input.sceneSummary,
      styleHint: input.styleHint,
    },
  })
  const conversationId = readText(input.conversationId)
  const characterId = readText(input.characterId)
  const sceneSummary = readText(input.sceneSummary)
  const imagePrompt = readText(input.imagePrompt) || readText(input.scenePrompt)
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
  if (!imagePrompt) throw new ConversationImageToolApiError('imagePrompt ist erforderlich.', 400)

  const width = clampDimension(input.width, DEFAULT_WIDTH)
  const height = clampDimension(input.height, DEFAULT_HEIGHT)
  const pollIntervalMs = clampInteger(input.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 200, 10_000)
  const maxPollAttempts = clampInteger(input.maxPollAttempts, DEFAULT_MAX_POLL_ATTEMPTS, 10, 300)
  const model: SupportedImageModel = parseSupportedImageModel(
    input.model,
    resolveDefaultConversationImageModel(),
  )
  const seed =
    typeof input.seed === 'number' && Number.isFinite(input.seed)
      ? Math.floor(input.seed)
      : Math.floor(Math.random() * 2_147_483_647)

  const characterYaml = await loadCharacterYaml(characterId)
  const prompt = buildHeroPrompt(characterId, sceneSummary, imagePrompt, styleHint, characterYaml)
  const characterName = characterYaml?.name?.trim() || characterId
  const interactionMetadata = buildInteractionMetadata(characterId, interactionTargets)
  const latestConversationReferencePaths = forceReferenceImagePaths
  const primaryReferencePaths =
    latestConversationReferencePaths.length === 0
      ? (await resolveCharacterImageRefs(characterId))
          .filter((item) => item.kind === 'standard')
          .map((item) => item.path)
      : []
  const referenceImagePaths = [...latestConversationReferencePaths, ...primaryReferencePaths]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => path.resolve(workspaceRoot, 'public', item.replace(/^\/+/, '')))
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 6)
  const styleMode = resolveReferenceStyleMode({
    latestConversationReferenceCount: latestConversationReferencePaths.length,
    identityReferenceCount: primaryReferencePaths.length,
  })

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
        imagePrompt,
        sceneSummary: sceneSummary || undefined,
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
        imagePrompt,
        sceneSummary: sceneSummary || undefined,
        styleHint: styleHint || undefined,
        ...interactionMetadata,
      },
    })

    await trackImageActivitySafely({
      activityType: 'conversation.scene.generating',
      isPublic: true,
      characterId,
      characterName,
      conversationId,
      metadata: {
        summary: `${characterName} erstellt eine neue Szene...`,
        sceneSummary: sceneSummary || undefined,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
      },
    })

    const requestResult = await generateImageWithModel({
      model,
      prompt,
      width,
      height,
      outputFormat: 'jpeg',
      seed,
      pollIntervalMs,
      maxPollAttempts,
      referenceImagePaths,
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
        requestId: requestResult.requestId,
        imagePrompt,
        sceneSummary: sceneSummary || undefined,
        imageGenerationPrompt: prompt,
        model,
        styleMode,
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
        requestId: requestResult.requestId,
        ...interactionMetadata,
      },
    })
    const remoteImageUrl = requestResult.imageUrl
    const storedImage = await storeConversationImageAsset({
      conversationId,
      imageUrl: remoteImageUrl,
      requestId: requestResult.requestId,
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
          requestId: requestResult.requestId,
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
    const imageVisualSummary = await describeImageWithFastModel({
      imageUrl,
      sceneSummary,
      fallbackText: sceneSummary || undefined,
    })
    const summary = buildImageGeneratedSummary(
      characterName,
      sceneSummary,
      imageVisualSummary,
      relatedCharacterNames,
    )
    const internalSummary = buildInternalImageGeneratedSummary(characterName)

    await appendConversationMessage({
      conversationId,
      role: 'system',
      content: internalSummary,
      eventType: 'tool.image.generated',
      metadata: {
        imageUrl,
        heroImageUrl: imageUrl,
        imageVisualSummary: imageVisualSummary || undefined,
        originalImageUrl: remoteImageUrl,
        imageAssetPath: storedImage?.localFilePath,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        summary: internalSummary,
        publicStorySummary: summary,
        prompt,
        imagePrompt,
        sceneSummary: sceneSummary || undefined,
        styleHint: styleHint || undefined,
        model,
        width,
        height,
        seed,
        requestId: requestResult.requestId,
        styleMode,
        relatedCharacterIds,
        relatedCharacterNames,
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
        summary: internalSummary,
        publicStorySummary: summary,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolId: CHARACTER_AGENT_TOOLS.showImage,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        requestId: requestResult.requestId,
        imagePrompt,
        sceneSummary: sceneSummary || undefined,
        imageVisualSummary: imageVisualSummary || undefined,
        styleMode,
        relatedCharacterIds,
        relatedCharacterNames,
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
        imagePrompt,
        sceneSummary: sceneSummary || undefined,
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
      storySummary: summary,
      metadata: {
        summary,
        sceneSummary: sceneSummary || undefined,
        imageVisualSummary: imageVisualSummary || undefined,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        conversationLinkLabel: 'View Full Conversation',
        heroImageUrl: imageUrl,
        imageUrl,
        originalImageUrl: remoteImageUrl,
        imageAssetPath: storedImage?.localFilePath,
        imagePrompt,
        model,
        width,
        height,
        requestId: requestResult.requestId,
        seed,
        styleMode,
        relatedCharacterIds,
        relatedCharacterNames,
        ...interactionMetadata,
      },
    })

    const result = {
      requestId: requestResult.requestId,
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
        imagePrompt,
        sceneSummary: sceneSummary || undefined,
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
    if (
      message.includes('BFL_API_KEY fehlt') ||
      message.includes('GOOGLE_GEMINI_API_KEY fehlt') ||
      message.includes('OPENAI_API_KEY fehlt') ||
      message.includes('Unsupported image model')
    ) {
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
      throw new ConversationImageToolApiError(message, 400)
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
