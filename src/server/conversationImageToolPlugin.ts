import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { parse as parseYaml } from 'yaml'
import { FluxClient } from '../../tools/character-image-service/src/fluxClient.ts'
import { appendConversationMessage } from './conversationStore.ts'
import { createActivity } from './activityStore.ts'
import {
  CHARACTER_AGENT_TOOLS,
  getCharacterAgentSkillPlaybook,
} from './characterAgentDefinitions.ts'

type MiddlewareStack = {
  use: (
    route: string,
    handler: (
      request: IncomingMessage,
      response: ServerResponse,
      next: (error?: unknown) => void,
    ) => void | Promise<void>,
  ) => void
}

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

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const DEFAULT_WIDTH = 1536
const DEFAULT_HEIGHT = 1152
const DEFAULT_POLL_INTERVAL_MS = 800
const DEFAULT_MAX_POLL_ATTEMPTS = 90

const summarizeScene = (scenePrompt: string): string => {
  const compact = scenePrompt.replace(/\s+/g, ' ').trim()
  if (compact.length <= 120) return compact
  return `${compact.slice(0, 117)}...`
}

const buildImageGeneratedSummary = (characterName: string, scenePrompt: string): string =>
  `${characterName} zeigt ein neues Bild: ${summarizeScene(scenePrompt)}`

const VISUAL_EXPRESSION_SKILL = getCharacterAgentSkillPlaybook('visual-expression')

const json = (response: ServerResponse, statusCode: number, data: unknown): void => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(data))
}

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

const clampDimension = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(768, Math.min(2048, Math.floor(value)))
}

const clampInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

const readText = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.trim()
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
  const yamlPath = path.resolve(
    workspaceRoot,
    'content/characters',
    characterId,
    'character.yaml',
  )
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
    `Hero-Hintergrund im Storytime-Stil, Querformat 4:3, fuer Vollbild-Background.`,
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

const registerConversationImageToolApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/tools', async (request, response, next) => {
    let failureContext:
      | {
          characterId: string
          characterName: string
          conversationId: string
          scenePrompt: string
        }
      | undefined
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')
      if (request.method !== 'POST' || requestUrl.pathname !== '/generate-conversation-hero') {
        next()
        return
      }

      const apiKey = process.env.BFL_API_KEY?.trim()
      if (!apiKey) {
        json(response, 400, {
          error: 'BFL_API_KEY fehlt. Bitte setze den FLUX API Key in der Umgebung.',
        })
        return
      }

      const body = await readJsonBody(request)
      const conversationId = readText(body.conversationId)
      const characterId = readText(body.characterId)
      const scenePrompt = readText(body.scenePrompt)
      const styleHint = readText(body.styleHint)

      if (!conversationId) {
        json(response, 400, { error: 'conversationId ist erforderlich.' })
        return
      }
      if (!characterId) {
        json(response, 400, { error: 'characterId ist erforderlich.' })
        return
      }
      if (!scenePrompt) {
        json(response, 400, { error: 'scenePrompt ist erforderlich.' })
        return
      }

      const width = clampDimension(body.width, DEFAULT_WIDTH)
      const height = clampDimension(body.height, DEFAULT_HEIGHT)
      const pollIntervalMs = clampInteger(body.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 200, 10_000)
      const maxPollAttempts = clampInteger(body.maxPollAttempts, DEFAULT_MAX_POLL_ATTEMPTS, 10, 300)
      const model = 'flux-2-flex'
      const seed =
        typeof body.seed === 'number' && Number.isFinite(body.seed)
          ? Math.floor(body.seed)
          : Math.floor(Math.random() * 2_147_483_647)

      const characterYaml = await loadCharacterYaml(characterId)
      const prompt = buildHeroPrompt(characterId, scenePrompt, styleHint, characterYaml)
      const characterName = characterYaml?.name?.trim() || characterId
      failureContext = { characterId, characterName, conversationId, scenePrompt }
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
        },
      })
      console.log(
        [
          '[conversation-image-tool] Prompt sent to FLUX:',
          prompt,
          `[conversation-image-tool] conversationId=${conversationId} characterId=${characterId} seed=${seed} model=${model}`,
        ].join('\n'),
      )

      const client = new FluxClient(apiKey)
      const requestResult = await client.generateTextToImage({
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
        json(response, 502, {
          error: errorMessage ?? 'FLUX konnte kein Hero-Bild erzeugen.',
          status: pollResult.status,
        })
        return
      }

      const imageUrl = pollResult.result.sample
      const summary = buildImageGeneratedSummary(characterName, scenePrompt)

      await appendConversationMessage({
        conversationId,
        role: 'system',
        content: summary,
        eventType: 'tool.image.generated',
        metadata: {
          imageUrl,
          heroImageUrl: imageUrl,
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
          scenePrompt,
          model,
          width,
          height,
          requestId: requestResult.id,
          seed,
        },
      })

      json(response, 200, {
        requestId: requestResult.id,
        imageUrl,
        heroImageUrl: imageUrl,
        summary,
        model,
        width,
        height,
        seed,
        cost: requestResult.cost,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (failureContext) {
        await trackImageActivitySafely({
          activityType: 'tool.image.failed',
          isPublic: false,
          characterId: failureContext.characterId,
          characterName: failureContext.characterName,
          conversationId: failureContext.conversationId,
          metadata: {
            summary: `${failureContext.characterName} konnte das Bild nicht erstellen`,
            skillId: VISUAL_EXPRESSION_SKILL?.id,
            toolId: CHARACTER_AGENT_TOOLS.generateImage,
            scenePrompt: failureContext.scenePrompt,
            reason: message,
          },
        })
      }
      const statusCode =
        message.includes('erforderlich') || message.includes('nicht gefunden') ? 400 : 500
      json(response, statusCode, { error: message })
    }
  })
}

export const conversationImageToolApiPlugin = (): Plugin => ({
  name: 'storytime-conversation-image-tool-api',
  configureServer(server) {
    registerConversationImageToolApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerConversationImageToolApi(server.middlewares)
  },
})
