import type { Character } from '../../../src/content/types.ts'
import type { AssetGenerationRecord, GenerationManifest } from './types.ts'
import { readImageAsDataUrl } from './imageDataUrl.ts'
import { STORYTIME_STYLE_PROFILE, describeStorytimeStyleProfile } from './storytimeStyleProfile.ts'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const OPENAI_FAST_VISION_MODEL = 'gpt-4o-mini'

export type ImageEvaluationResult = {
  assetType: string
  imagePath: string
  pass: boolean
  childFriendly: boolean
  styleScore: number
  safetyScore: number
  identityScore: number
  anomaliesDetected: boolean
  riskFlags: string[]
  summary: string
  styleNotes: string
  safetyNotes: string
  identityNotes: string
}

export type ImageEvaluationSetResult = {
  pass: boolean
  results: ImageEvaluationResult[]
}

const clampScore = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10))
}

const normalizeStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []

const summarizeCharacter = (character: Character): string =>
  [
    `Name: ${character.name}`,
    `Kurzbeschreibung: ${character.shortDescription}`,
    `Spezies: ${character.basis.species}`,
    `Koerperform: ${character.appearance.bodyShape}`,
    `Farben: ${character.appearance.colors.join(', ')}`,
    `Augen: ${character.appearance.eyes.color}, ${character.appearance.eyes.expression}`,
    `Auffaellige Merkmale: ${character.appearance.distinctiveFeatures.join(', ')}`,
    `Kleidungsstil: ${character.appearance.clothingStyle}`,
    `Charakterzuege: ${character.personality.coreTraits.join(', ')}`,
    `Angst: ${character.storyPsychology.fear}`,
    `Selbstzweifel: ${character.storyPsychology.insecurity}`,
  ].join('\n')

const assetSpecificEvaluationNotes = (assetType: string): string => {
  if (assetType === 'hero-image') {
    return [
      '- erwarte eine warme cinematic Adventure-Szene mit klarer Tiefenstaffelung',
      '- Hintergrund, Licht und Umgebung sind hier wichtig und sollen bewertet werden',
    ].join('\n')
  }

  if (assetType === 'standard-figur' || assetType.startsWith('emotion_')) {
    return [
      '- ein transparenter oder neutral sauber isolierter Hintergrund ist hier korrekt und darf NICHT negativ bewertet werden',
      '- bewerte stattdessen besonders Silhouette, Anatomie, Emotionslesbarkeit und Character-Identitaet',
    ].join('\n')
  }

  if (assetType === 'portrait' || assetType === 'profilbild') {
    return [
      '- ein cleaner oder einfacher Hintergrund ist hier akzeptabel und darf nur dann negativ gewertet werden, wenn er die Lesbarkeit stoert',
      '- bewerte besonders Gesicht, Crop, Ausdruck, kleine Lesbarkeit und Character-Identitaet',
    ].join('\n')
  }

  return '- bewerte Stil, Sicherheit, Anomalien und Character-Identitaet passend zum Asset-Typ'
}

const buildEvaluationPrompt = (input: {
  assetType: string
  character: Character
  styleGuideText?: string
}): string =>
  [
    'Pruefe dieses Character-Bild fuer Storytime.',
    `Asset-Typ: ${input.assetType}`,
    '',
    '## Character-Anker',
    summarizeCharacter(input.character),
    '',
    '## Storytime-Stilprofil',
    describeStorytimeStyleProfile(),
    '',
    input.styleGuideText ? ['## Zusetzlicher Style Guide', input.styleGuideText, ''].join('\n') : '',
    '## Bewertungsauftrag',
    'Bewerte streng, aber fair.',
    'Achte besonders auf:',
    '- kindgerechten, warmen Look',
    '- keine gruseligen, sexualisierten oder ungeeigneten Inhalte',
    '- keine offensichtlichen Anomalien wie deformierte Haende, kaputte Anatomie oder verstuemmte Gliedmassen',
    '- klare Passung zum Storytime-Stil',
    '- Identitaetskonsistenz zur Character-Beschreibung',
    '',
    '## Asset-spezifische Hinweise',
    assetSpecificEvaluationNotes(input.assetType),
    '',
    'Gib NUR JSON mit den Feldern zurueck:',
    '{"pass":boolean,"childFriendly":boolean,"styleScore":number,"safetyScore":number,"identityScore":number,"anomaliesDetected":boolean,"riskFlags":string[],"summary":string,"styleNotes":string,"safetyNotes":string,"identityNotes":string}',
  ]
    .filter(Boolean)
    .join('\n')

const stripMarkdownFences = (text: string): string => {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i)
  return fenced ? fenced[1].trim() : text.trim()
}

const parseEvaluationResponse = (
  rawText: string,
  assetType: string,
  imagePath: string,
): ImageEvaluationResult => {
  const parsed = JSON.parse(stripMarkdownFences(rawText)) as Record<string, unknown>
  const childFriendly = parsed.childFriendly === true
  const anomaliesDetected = parsed.anomaliesDetected === true
  const styleScore = clampScore(parsed.styleScore)
  const safetyScore = clampScore(parsed.safetyScore)
  const identityScore = clampScore(parsed.identityScore)
  const riskFlags = normalizeStringArray(parsed.riskFlags)

  return {
    assetType,
    imagePath,
    pass:
      parsed.pass === true &&
      childFriendly &&
      !anomaliesDetected &&
      styleScore >= 7 &&
      safetyScore >= 8 &&
      identityScore >= 7,
    childFriendly,
    styleScore,
    safetyScore,
    identityScore,
    anomaliesDetected,
    riskFlags,
    summary: typeof parsed.summary === 'string' ? parsed.summary : 'Keine Zusammenfassung vorhanden.',
    styleNotes: typeof parsed.styleNotes === 'string' ? parsed.styleNotes : '',
    safetyNotes: typeof parsed.safetyNotes === 'string' ? parsed.safetyNotes : '',
    identityNotes: typeof parsed.identityNotes === 'string' ? parsed.identityNotes : '',
  }
}

const extractResponsesOutputText = (payload: unknown): string => {
  if (typeof payload !== 'object' || payload === null) {
    return ''
  }

  const directText =
    typeof (payload as { output_text?: unknown }).output_text === 'string'
      ? (payload as { output_text: string }).output_text.trim()
      : ''
  if (directText) {
    return directText
  }

  const nestedOutput = Array.isArray((payload as { output?: unknown }).output)
    ? ((payload as { output: Array<{ content?: unknown }> }).output ?? [])
    : []

  for (const item of nestedOutput) {
    const contentItems = Array.isArray(item.content) ? item.content : []
    for (const contentItem of contentItems) {
      if (
        typeof contentItem === 'object' &&
        contentItem !== null &&
        (contentItem as { type?: unknown }).type === 'output_text' &&
        typeof (contentItem as { text?: unknown }).text === 'string'
      ) {
        return (contentItem as { text: string }).text.trim()
      }
    }
  }

  return ''
}

export const evaluateCharacterImage = async (input: {
  imagePath: string
  assetType: string
  character: Character
  styleGuideText?: string
}): Promise<ImageEvaluationResult> => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY fehlt fuer die Bild-Evaluation.')
  }

  const imageDataUrl = await readImageAsDataUrl(input.imagePath)
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_FAST_VISION_MODEL,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: 'Du bist ein strenger, kinderfreundlicher Bild-Evaluator fuer Storytime. Antworte nur mit JSON.',
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: buildEvaluationPrompt(input),
            },
            {
              type: 'input_image',
              image_url: imageDataUrl,
            },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`OpenAI Bild-Evaluation fehlgeschlagen (${response.status}): ${errorBody}`)
  }

  const payload = await response.json()
  const rawText = extractResponsesOutputText(payload)
  if (!rawText) {
    throw new Error('OpenAI Bild-Evaluation lieferte keinen lesbaren Text.')
  }

  return parseEvaluationResponse(rawText, input.assetType, input.imagePath)
}

export const evaluateGeneratedCharacterImages = async (input: {
  manifest: GenerationManifest
  styleGuideText?: string
}): Promise<ImageEvaluationSetResult> => {
  const generatedAssets = input.manifest.assets.filter(
    (asset): asset is AssetGenerationRecord => asset.status === 'generated',
  )
  const results: ImageEvaluationResult[] = []

  for (const asset of generatedAssets) {
    results.push(
      await evaluateCharacterImage({
        imagePath: asset.outputFilePath,
        assetType: asset.type,
        character: input.manifest.character,
        styleGuideText: input.styleGuideText,
      }),
    )
  }

  return {
    pass: results.every((result) => result.pass),
    results,
  }
}

export const STORYTIME_EVALUATION_PROFILE_ID = STORYTIME_STYLE_PROFILE.id
