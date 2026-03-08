import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { FluxClient } from '../../tools/character-image-service/src/fluxClient.ts'
import type { FluxModel } from '../../tools/character-image-service/src/types.ts'
import { createActivity } from './activityStore.ts'
import {
  CHARACTER_AGENT_TOOLS,
  getCharacterAgentSkillPlaybook,
} from './characterAgentDefinitions.ts'
import { appendConversationMessage, getConversationDetails } from './conversationStore.ts'
import { listRelationshipsForCharacter } from './relationshipStore.ts'

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
  bilder?: {
    hero_image?: {
      datei?: string
    }
    portrait?: {
      datei?: string
    }
    profilbild?: {
      datei?: string
    }
  }
}

type CharacterReference = {
  characterId: string
  name: string
  species: string
  shortDescription: string
  referencePaths: string[]
}

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const IMAGE_MODEL: FluxModel = 'flux-2-flex'
const HERO_WIDTH = 1280
const HERO_HEIGHT = 960
const POLL_INTERVAL_MS = 500
const MAX_POLL_ATTEMPTS = 90
const MIN_PROMPT_LENGTH = 18
const MAX_PROMPT_LENGTH = 700
const CONVERSATION_COOLDOWN_MS = 25_000

const lastGenerationByConversation = new Map<string, number>()
const pendingConversationGenerations = new Set<string>()
const pendingExplicitImageRequestsByConversation = new Map<string, string>()

const summarizeScene = (scenePrompt: string): string => {
  const compact = scenePrompt.replace(/\s+/g, ' ').trim()
  if (compact.length <= 120) return compact
  return `${compact.slice(0, 117)}...`
}

const buildImageGeneratedSummary = (characterName: string, scenePrompt: string): string =>
  `${characterName} zeigt ein neues Bild: ${summarizeScene(scenePrompt)}`

const VISUAL_EXPRESSION_SKILL = getCharacterAgentSkillPlaybook('visual-expression')

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

const readText = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const clampText = (value: string): string => value.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT_LENGTH)

const extractExplicitUserWish = (userText: string): string => {
  const normalized = clampText(userText)
  if (!normalized) return ''

  const patterns = [
    /ich\s+(?:will|moechte)\s+(.+?)\s+sehen[.!?]?$/i,
    /zeig\s+mir\s+(.+?)[.!?]?$/i,
    /kannst\s+du\s+mir\s+(.+?)\s+zeigen[.!?]?$/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(normalized)
    if (match?.[1]) {
      return clampText(match[1])
    }
  }
  return ''
}

const hasExplicitImageRequest = (userText: string): boolean => {
  const normalized = clampText(userText)
  if (!normalized) return false
  if (extractExplicitUserWish(normalized)) return true

  return /(bild|szene|zeigen|zeig|illustrier|zeichn|mal\s+mir|visualisier|generier).{0,80}(bitte|mal|jetzt)?/i.test(
    normalized,
  )
}

export const noteExplicitImageRequestFromUserMessage = (input: {
  conversationId: string
  userText: string
}): void => {
  const conversationId = input.conversationId.trim()
  if (!conversationId) return
  const userText = clampText(input.userText)
  if (!hasExplicitImageRequest(userText)) return
  pendingExplicitImageRequestsByConversation.set(conversationId, userText)
  console.log(`[conversation-image] queued explicit image request (conversationId=${conversationId})`)
}

const extractScenePrompt = (
  assistantText: string,
  eventType?: string,
  lastUserText?: string,
): string | null => {
  const normalized = assistantText.trim()
  if (!normalized) return null

  // Bewusster, klarer Marker fuer "ich zeige dir ..."-Momente.
  const explicitMarker =
    /ich\s+zeige\s+dir\s+jetzt[:-]?\s*([\s\S]+)$/i.exec(normalized) ??
    /schau\s+mal[:-]?\s*([\s\S]+)$/i.exec(normalized)
  const extractedAssistant = clampText(explicitMarker?.[1] ?? normalized)
  const extractedUser = clampText(lastUserText ?? '')
  const explicitWish = extractExplicitUserWish(extractedUser)
  const userExplicitlyAskedForImage = hasExplicitImageRequest(extractedUser)
  if (!userExplicitlyAskedForImage) return null

  const hasVisualIntent =
    /(ich\s+zeige\s+dir|schau\s+mal|stell\s+dir\s+vor|siehst\s+du|blick\s+auf)/i.test(normalized)

  // Fallback: Bei normalen Assistant-Transcripts mit genug Inhalt ebenfalls Bild erlauben.
  const isAssistantTranscript = eventType === 'response.audio_transcript.done'
  if (!hasVisualIntent && !isAssistantTranscript) return null
  const base = extractedAssistant.length >= MIN_PROMPT_LENGTH ? extractedAssistant : extractedUser
  if (base.length < MIN_PROMPT_LENGTH) return null

  // Wenn die Assistant-Szene sehr kurz/abgeschnitten wirkt, User-Wunsch dazunehmen.
  const assistantLooksThin =
    extractedAssistant.length < 48 ||
    /[\s-][a-z]{1,2}$/i.test(extractedAssistant) ||
    !/[.!?]$/.test(extractedAssistant)

  if (explicitWish && !base.toLowerCase().includes(explicitWish.toLowerCase())) {
    return clampText(`${base}. EXPLIZITER KINDWUNSCH (MUSS SICHTBAR SEIN): ${explicitWish}`)
  }

  if (extractedUser && assistantLooksThin && !base.includes(extractedUser)) {
    return clampText(`${base}. Genau gewuenschte Kind-Szene: ${extractedUser}`)
  }

  if (extractedUser && !base.includes(extractedUser) && extractedUser.length > 24) {
    return clampText(`${base}. Kontext aus dem Kindwunsch: ${extractedUser}`)
  }

  return base
}

const takeTop = (input: string[] | undefined, limit: number): string =>
  Array.isArray(input)
    ? input
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .slice(0, limit)
        .join(', ')
    : ''

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

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const toWorkspacePublicPath = (publicUrlPath: string): string =>
  path.resolve(workspaceRoot, 'public', publicUrlPath.replace(/^\/+/, ''))

const resolveReferencePaths = async (
  characterId: string,
  yaml: CharacterYaml | null,
): Promise<string[]> => {
  const yamlHeroPath = readText(yaml?.bilder?.hero_image?.datei)
  const yamlPortraitPath = readText(yaml?.bilder?.portrait?.datei)
  const yamlProfilePath = readText(yaml?.bilder?.profilbild?.datei)
  const candidates = [
    yamlHeroPath,
    yamlPortraitPath,
    yamlProfilePath,
    `/content/characters/${characterId}/hero-image.jpg`,
    `/content/characters/${characterId}/hero-image.png`,
    `/content/characters/${characterId}/portrait.png`,
    `/content/characters/${characterId}/profilbild.png`,
  ]
    .filter((item) => item.length > 0)
    .map((item) => toWorkspacePublicPath(item))

  const resolved: string[] = []
  for (const candidate of candidates) {
    if ((await fileExists(candidate)) && !resolved.includes(candidate)) {
      resolved.push(candidate)
    }
  }
  return resolved
}

const normalizeText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

const textContainsWord = (text: string, candidate: string): boolean => {
  const safe = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(^|[^a-z0-9])${safe}([^a-z0-9]|$)`, 'i')
  return regex.test(text)
}

const loadCharacterReference = async (characterId: string): Promise<CharacterReference> => {
  const yaml = await loadCharacterYaml(characterId)
  const name = readText(yaml?.name) || characterId
  return {
    characterId,
    name,
    species: readText(yaml?.basis?.species) || 'Figur',
    shortDescription: readText(yaml?.kurzbeschreibung),
    referencePaths: await resolveReferencePaths(characterId, yaml),
  }
}

const selectRequestedRelatedCharacters = (
  scenePrompt: string,
  lastUserText: string,
  relatedCharacters: CharacterReference[],
): CharacterReference[] => {
  const haystack = normalizeText(`${scenePrompt} ${lastUserText}`)
  const mentioned = relatedCharacters.filter((related) => {
    const normalizedName = normalizeText(related.name)
    const normalizedId = normalizeText(related.characterId)
    return textContainsWord(haystack, normalizedName) || textContainsWord(haystack, normalizedId)
  })
  return mentioned.slice(0, 3)
}

const buildHeroPrompt = (characterId: string, scenePrompt: string, yaml: CharacterYaml | null): string => {
  const name = readText(yaml?.name) || characterId
  const species = readText(yaml?.basis?.species) || 'Figur'
  const shortDescription = readText(yaml?.kurzbeschreibung)
  const colors = takeTop(yaml?.erscheinung?.colors, 4)
  const features = takeTop(yaml?.erscheinung?.distinctive_features, 4)

  return [
    'SYSTEM STYLE LOCK:',
    'Erzeuge EIN Hero-Hintergrundbild im Storytime-Stil in 4:3 Querformat fuer Vollbild.',
    'Das Ergebnis muss visuell so aussehen wie das vorhandene Hero-Bild dieser Figur (gleiches Color Grading, gleiches Licht, gleicher Pinsel-/Render-Look).',
    '',
    'CHARAKTER:',
    `Name: ${name}`,
    `Spezies: ${species}`,
    shortDescription ? `Kurzbeschreibung: ${shortDescription}` : '',
    colors ? `Signalfarben: ${colors}` : '',
    features ? `Signatur-Merkmale: ${features}` : '',
    '',
    'SZENE (WORTWOERTLICH UND VOLLSTAENDIG UMSETZEN):',
    `"${scenePrompt}"`,
    'Zeige die Szene konkret mit klarer Komposition (Vordergrund, Mittelgrund, Hintergrund) und gut lesbarer Handlung.',
    '',
    'HARTE NEGATIV-REGELN (UNBEDINGT EINHALTEN):',
    '- KEIN Text',
    '- KEINE Buchstaben',
    '- KEINE Woerter',
    '- KEINE Zahlen',
    '- KEINE Runen/Symbole/Logos',
    '- KEIN UI/HUD/Untertitel/Watermark',
    '- kein Horror, keine Gewalt',
  ]
    .filter((line) => line.length > 0)
    .join('\n')
}

const buildFluxEditPrompt = (input: {
  characterName: string
  scenePrompt: string
  lastUserText: string
  relatedCharacters: CharacterReference[]
}): string => {
  const explicitWish = extractExplicitUserWish(input.lastUserText)
  const mustIncludeLine = explicitWish
    ? `MUSS ENTHALTEN: ${explicitWish}.`
    : 'MUSS ENTHALTEN: den zentralen Wunsch aus der letzten Kind-Nachricht.'
  const relatedBlock =
    input.relatedCharacters.length > 0
      ? [
          'ZUSAETZLICHE FIGUREN (MITSPIELER, MUESSEN ERKENNBAR SEIN):',
          ...input.relatedCharacters.map(
            (related) =>
              `- ${related.name} (${related.species})${related.shortDescription ? `: ${related.shortDescription}` : ''}`,
          ),
          'Wenn die Szene "mit" einer dieser Figuren verlangt, muessen diese sichtbar sein.',
        ].join('\n')
      : 'Keine zusaetzlichen Figuren explizit angefordert.'

  return [
    `Nutze das Referenzbild von ${input.characterName} als strikte Stil- und Identitaetsvorlage.`,
    'Bearbeite/erweitere die Szene in exakt diesem Look (gleiches Color Grading, Licht, Render-Stil).',
    `Szenenziel: ${input.scenePrompt}`,
    mustIncludeLine,
    relatedBlock,
    'Keine Schrift, keine Buchstaben, keine Zahlen, keine Logos, kein UI, kein Wasserzeichen.',
    'Kindgerecht, freundlich, klar lesbar, kein Horror, keine Gewalt.',
  ].join('\n')
}

const generateImageWithReference = async (input: {
  client: FluxClient
  prompt: string
  seed: number
  referenceImagePaths: string[]
}): Promise<{ requestId: string; pollingUrl: string; cost?: number; model: FluxModel }> => {
  const { client, prompt, seed, referenceImagePaths } = input

  if (referenceImagePaths.length > 0) {
    const result = await client.editImage({
      model: IMAGE_MODEL,
      prompt,
      width: HERO_WIDTH,
      height: HERO_HEIGHT,
      outputFormat: 'jpeg',
      seed,
      referenceImagePaths,
    })
    return {
      requestId: result.id,
      pollingUrl: result.polling_url,
      cost: result.cost,
      model: IMAGE_MODEL,
    }
  }

  const result = await client.generateTextToImage({
    model: IMAGE_MODEL,
    prompt,
    width: HERO_WIDTH,
    height: HERO_HEIGHT,
    outputFormat: 'jpeg',
    seed,
  })
  return {
    requestId: result.id,
    pollingUrl: result.polling_url,
    cost: result.cost,
    model: IMAGE_MODEL,
  }
}

const isGenerationOnCooldown = (conversationId: string): boolean => {
  const now = Date.now()
  const last = lastGenerationByConversation.get(conversationId)
  return typeof last === 'number' && now - last < CONVERSATION_COOLDOWN_MS
}

const markGenerationAttempt = (conversationId: string): void => {
  lastGenerationByConversation.set(conversationId, Date.now())
}

export const maybeGenerateSceneImageFromAssistantMessage = async (input: {
  conversationId: string
  assistantText: string
  eventType?: string
}): Promise<void> => {
  const conversationId = input.conversationId.trim()
  if (!conversationId) return
  if (pendingConversationGenerations.has(conversationId)) return

  const apiKey = process.env.BFL_API_KEY?.trim()
  if (!apiKey) return

  if (!pendingExplicitImageRequestsByConversation.has(conversationId)) {
    console.log(
      `[conversation-image] skip: no queued explicit request (conversationId=${conversationId})`,
    )
    return
  }

  if (isGenerationOnCooldown(conversationId)) {
    console.log(`[conversation-image] skip: cooldown active (conversationId=${conversationId})`)
    return
  }

  const queuedUserRequestText = pendingExplicitImageRequestsByConversation.get(conversationId) ?? ''
  pendingExplicitImageRequestsByConversation.delete(conversationId)
  markGenerationAttempt(conversationId)

  pendingConversationGenerations.add(conversationId)
  let activityContext:
    | {
        characterId: string
        characterName: string
        scenePrompt: string
      }
    | undefined
  try {
    const details = await getConversationDetails(conversationId)
    const messages = details.messages
    const lastUserText =
      queuedUserRequestText ||
      ([...messages].reverse().find((item) => item.role === 'user')?.content?.trim() ?? '')
    const scenePrompt = extractScenePrompt(input.assistantText, input.eventType, lastUserText)
    if (!scenePrompt) return

    const characterId = details.conversation.characterId
    const yaml = await loadCharacterYaml(characterId)
    const characterName = readText(yaml?.name) || characterId
    activityContext = { characterId, characterName, scenePrompt }

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
        sourceEventType: input.eventType,
      },
    })

    const primaryReferencePaths = await resolveReferencePaths(characterId, yaml)
    const primaryHeroReferencePath = primaryReferencePaths[0] ?? null
    if (!primaryHeroReferencePath) {
      await trackImageActivitySafely({
        activityType: 'tool.image.failed',
        isPublic: false,
        characterId,
        characterName,
        conversationId,
        metadata: {
          summary: `${characterName} konnte kein Referenzbild finden`,
          scenePrompt,
          reason: 'no-reference-image',
        },
      })
      return
    }

    const relationships = await listRelationshipsForCharacter(characterId)
    await trackImageActivitySafely({
      activityType: 'tool.relationships.read',
      isPublic: false,
      characterId,
      characterName,
      conversationId,
      metadata: {
        summary: `${characterName} schaut ins Beziehungsnetz`,
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolId: CHARACTER_AGENT_TOOLS.readRelationships,
        relationshipCount: relationships.length,
      },
    })
    const relatedCharacterIds = Array.from(
      new Set(
        relationships.map((relationship) =>
          relationship.direction === 'outgoing'
            ? relationship.targetCharacterId
            : relationship.sourceCharacterId,
        ),
      ),
    ).filter((id) => id && id !== characterId)
    const relatedCandidates = await Promise.all(
      relatedCharacterIds.slice(0, 8).map((relatedId) => loadCharacterReference(relatedId)),
    )
    const requestedRelatedCharacters = selectRequestedRelatedCharacters(
      scenePrompt,
      lastUserText,
      relatedCandidates,
    )
    const relatedReferencePaths = requestedRelatedCharacters
      .flatMap((related) => related.referencePaths.slice(0, 1))
      .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index)

    // Zwischenstufe: erst generischer Storytime-Scene-Intent, dann dedizierter FLUX-Edit-Prompt.
    const sceneIntentPrompt = buildHeroPrompt(characterId, scenePrompt, yaml)
    const fluxEditPrompt = buildFluxEditPrompt({
      characterName,
      scenePrompt: sceneIntentPrompt,
      lastUserText,
      relatedCharacters: requestedRelatedCharacters,
    })

    const client = new FluxClient(apiKey)
    const seed = Math.floor(Math.random() * 2_147_483_647)
    const referenceImagePaths = [primaryHeroReferencePath, ...relatedReferencePaths].slice(0, 6)
    const requestResult = await generateImageWithReference({
      client,
      prompt: fluxEditPrompt,
      seed,
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
        scenePrompt,
        imageGenerationPrompt: fluxEditPrompt,
        model: requestResult.model,
        styleMode: referenceImagePaths.length > 0 ? 'hero-reference-image-edit' : 'text-only-fallback',
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
      },
    })
    console.log(
      [
        '[conversation-image] Prompt sent to FLUX:',
        fluxEditPrompt,
        `[conversation-image] conversationId=${conversationId} characterId=${characterId} seed=${seed} model=${requestResult.model}`,
      ].join('\n'),
    )
    const pollResult = await client.pollResult({
      pollingUrl: requestResult.pollingUrl,
      pollIntervalMs: POLL_INTERVAL_MS,
      maxAttempts: MAX_POLL_ATTEMPTS,
    })
    if (pollResult.status !== 'Ready') {
      const reason = 'error' in pollResult ? pollResult.error : pollResult.status
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
          requestId: requestResult.requestId,
          status: pollResult.status,
          reason,
        },
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
        heroImageUrl: imageUrl,
        imageUrl,
        imageLinkUrl: imageUrl,
        imageLinkLabel: 'Bild ansehen',
        skillId: VISUAL_EXPRESSION_SKILL?.id,
        toolIds: VISUAL_EXPRESSION_SKILL?.toolIds ?? [],
        imageGenerationPrompt: fluxEditPrompt,
        imageSceneIntentPrompt: sceneIntentPrompt,
        scenePrompt,
        model: requestResult.model,
        width: HERO_WIDTH,
        height: HERO_HEIGHT,
        requestId: requestResult.requestId,
        styleMode: referenceImagePaths.length > 0 ? 'hero-reference-image-edit' : 'text-only-fallback',
        relatedCharacterIds: requestedRelatedCharacters.map((related) => related.characterId),
        relatedCharacterNames: requestedRelatedCharacters.map((related) => related.name),
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
        requestId: requestResult.requestId,
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
        imageLinkUrl: imageUrl,
        imageLinkLabel: 'Bild ansehen',
        imageGenerationPrompt: fluxEditPrompt,
        imageSceneIntentPrompt: sceneIntentPrompt,
        scenePrompt,
        model: requestResult.model,
        styleMode: referenceImagePaths.length > 0 ? 'hero-reference-image-edit' : 'text-only-fallback',
        relatedCharacterIds: requestedRelatedCharacters.map((related) => related.characterId),
        relatedCharacterNames: requestedRelatedCharacters.map((related) => related.name),
      },
    })
  } catch (error) {
    // Bild-Generierung ist best-effort und darf den Conversation-Flow nicht stoeren.
    const message = error instanceof Error ? error.message : String(error)
    if (activityContext) {
      await trackImageActivitySafely({
        activityType: 'tool.image.failed',
        isPublic: false,
        characterId: activityContext.characterId,
        characterName: activityContext.characterName,
        conversationId,
        metadata: {
          summary: `${activityContext.characterName} konnte das Bild nicht erstellen`,
          skillId: VISUAL_EXPRESSION_SKILL?.id,
          toolId: CHARACTER_AGENT_TOOLS.generateImage,
          scenePrompt: activityContext.scenePrompt,
          reason: message,
        },
      })
    }
    console.warn(`Conversation image generation skipped: ${message}`)
  } finally {
    pendingConversationGenerations.delete(conversationId)
  }
}
