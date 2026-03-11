import { parse, stringify } from 'yaml'

const MAIN_IMAGE_FILE_NAMES = {
  standard_figur: 'standard-figur.png',
  hero_image: 'hero-image.jpg',
  portrait: 'portrait.png',
  profilbild: 'profilbild.png',
} as const

const STANDARD_EMOTION_IMAGES = [
  {
    type: 'emotion_happy',
    fileName: 'emotion-happy.png',
    description: (name: string) =>
      `Freigestellte Emotionsfigur von ${name} mit grossem offenem Laecheln, leuchtenden Augen, gehobenen Armen oder springender Freude und klar lesbarer Gluecks-Pose ohne Hintergrund.`,
  },
  {
    type: 'emotion_sad',
    fileName: 'emotion-sad.png',
    description: (name: string) =>
      `Freigestellte Emotionsfigur von ${name} mit traurigem Blick, leicht gesenkten Schultern, weicher verletzlicher Koerpersprache und klar lesbarer trauriger Pose ohne Hintergrund.`,
  },
] as const

const LEGACY_STANDARD_EMOTION_TYPES = new Set(['emotion_brave', 'emotion_shy'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const ensureRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

export const ensureStandardCharacterImages = (
  document: Record<string, unknown>,
  characterId: string,
): Record<string, unknown> => {
  const images = ensureRecord(document.bilder)
  const characterName = typeof document.name === 'string' && document.name.trim().length > 0
    ? document.name.trim()
    : 'dem Character'

  for (const [key, fileName] of Object.entries(MAIN_IMAGE_FILE_NAMES)) {
    const entry = ensureRecord(images[key])
    entry.datei = `/content/characters/${characterId}/${fileName}`
    images[key] = entry
  }

  const existingAdditionalImages = Array.isArray(images.weitere_bilder)
    ? images.weitere_bilder.filter(isRecord)
    : []
  const additionalByType = new Map<string, Record<string, unknown>>()

  for (const image of existingAdditionalImages) {
    const type = typeof image.typ === 'string' ? image.typ.trim() : ''
    if (type && !LEGACY_STANDARD_EMOTION_TYPES.has(type)) {
      additionalByType.set(type, { ...image })
    }
  }

  for (const standardImage of STANDARD_EMOTION_IMAGES) {
    const existing = additionalByType.get(standardImage.type) ?? { typ: standardImage.type }
    existing.typ = standardImage.type
    existing.datei = `/content/characters/${characterId}/${standardImage.fileName}`
    if (typeof existing.beschreibung !== 'string' || existing.beschreibung.trim().length === 0) {
      existing.beschreibung = standardImage.description(characterName)
    }
    additionalByType.set(standardImage.type, existing)
  }

  images.weitere_bilder = [...additionalByType.values()]
  document.bilder = images

  return document
}

export const normalizeCharacterYamlWithStandardImages = (
  yamlText: string,
  characterId: string,
): string => {
  const parsed = parse(yamlText) as Record<string, unknown>
  parsed.id = characterId
  ensureStandardCharacterImages(parsed, characterId)
  return stringify(parsed, { lineWidth: 0 })
}

export const STANDARD_CHARACTER_EMOTION_TYPES = STANDARD_EMOTION_IMAGES.map((image) => image.type)
