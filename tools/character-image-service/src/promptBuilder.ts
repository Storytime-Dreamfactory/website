import path from 'node:path'
import type { Character } from '../../../src/content/types.ts'
import { STORYTIME_STYLE_PROFILE, describeStorytimeStyleProfile } from './storytimeStyleProfile.ts'
import type { AssetKind, CharacterAssetSpec, FluxModel, ResolvedAssetJob } from './types.ts'

const EMOTION_ASSET_LABELS: Record<string, string> = {
  emotion_happy: 'Emotion Happy',
  emotion_sad: 'Emotion Sad',
}

const CHARACTER_ASSET_SPECS: Record<Exclude<AssetKind, 'additional'>, CharacterAssetSpec> = {
  standard_figur: {
    kind: 'standard_figur',
    label: 'Standard Figur',
    width: 1024,
    height: 1536,
    outputFormat: 'png',
    defaultFileName: 'standard-figur.png',
    mode: 'text-to-image',
  },
  hero_image: {
    kind: 'hero_image',
    label: 'Hero Image',
    width: 1920,
    height: 1088,
    outputFormat: 'jpeg',
    defaultFileName: 'hero-image.jpg',
    mode: 'image-edit',
    useHeroModel: true,
  },
  portrait: {
    kind: 'portrait',
    label: 'Portrait',
    width: 896,
    height: 1200,
    outputFormat: 'png',
    defaultFileName: 'portrait.png',
    mode: 'image-edit',
  },
  profilbild: {
    kind: 'profilbild',
    label: 'Profilbild',
    width: 512,
    height: 512,
    outputFormat: 'png',
    defaultFileName: 'profilbild.png',
    mode: 'image-edit',
  },
}

const additionalAssetSpec = (type: string): CharacterAssetSpec => ({
  kind: 'additional',
  label: EMOTION_ASSET_LABELS[type] ?? `Additional Asset (${type})`,
  width: 1024,
  height: type.startsWith('emotion_') ? 1408 : 1024,
  outputFormat: 'png',
  defaultFileName: `${slugify(type)}.png`,
  mode: 'image-edit',
})

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const joinParts = (parts: Array<string | undefined>): string => parts.filter(Boolean).join(' ')

const withPeriod = (value: string): string => `${value.trim().replace(/[.?!]+$/g, '')}.`

const normalizePathSlashes = (value: string): string => value.replace(/\\/g, '/')

const resolvePublicFilePath = (
  character: Character,
  configuredPath: string | undefined,
  fileName: string,
): string => {
  if (!configuredPath) {
    return `/content/characters/${character.id}/${fileName}`
  }

  if (configuredPath.startsWith('/')) {
    return configuredPath
  }

  return `/content/characters/${character.id}/${configuredPath}`
}

const resolveOutputFilePath = (outputRoot: string, publicFilePath: string): string => {
  const normalized = normalizePathSlashes(publicFilePath)
  const relative = normalized.startsWith('/content/characters/')
    ? normalized.slice('/content/characters/'.length)
    : normalized.replace(/^\/+/, '')

  return path.resolve(outputRoot, relative)
}

const baseIdentity = (character: Character): string =>
  joinParts([
    withPeriod(`Character name: ${character.name}`),
    withPeriod(`Short description: ${character.shortDescription}`),
    withPeriod(`Species: ${character.basis.species}`),
    withPeriod(
      `The character must read unmistakably as a ${character.basis.species} at first glance and must never be mistaken for another species`,
    ),
    character.basis.ageHint ? withPeriod(`Age feel: ${character.basis.ageHint}`) : undefined,
    character.basis.roleArchetype
      ? withPeriod(`Archetype: ${character.basis.roleArchetype}`)
      : undefined,
    withPeriod(`Body shape: ${character.appearance.bodyShape}`),
    withPeriod(`Dominant colors: ${character.appearance.colors.join(', ')}`),
    character.appearance.hairOrFur.color
      ? withPeriod(`Hair or fur: ${joinParts([
          character.appearance.hairOrFur.color,
          character.appearance.hairOrFur.texture,
          character.appearance.hairOrFur.length,
        ])}`)
      : undefined,
    withPeriod(`Eyes: ${character.appearance.eyes.color}, ${character.appearance.eyes.expression}`),
    withPeriod(
      `Distinctive features: ${character.appearance.distinctiveFeatures.join(', ')}`,
    ),
    withPeriod(
      'Keep species-defining face shape, ears, tail, paw shape, and silhouette visible whenever the crop allows it',
    ),
    withPeriod(`Clothing style: ${character.appearance.clothingStyle}`),
  ])

const personalityAnchor = (character: Character): string =>
  joinParts([
    withPeriod(`Core traits: ${character.personality.coreTraits.join(', ')}`),
    withPeriod(`Temperament: ${character.personality.temperament}`),
    withPeriod(`Social style: ${character.personality.socialStyle}`),
    withPeriod(`Strengths: ${character.personality.strengths.join(', ')}`),
    withPeriod(`Weaknesses: ${character.personality.weaknesses.join(', ')}`),
    character.personality.quirks.length > 0
      ? withPeriod(`Quirks: ${character.personality.quirks.join(', ')}`)
      : undefined,
    withPeriod(`Visible goal: ${character.storyPsychology.visibleGoal}`),
    withPeriod(`Deeper need: ${character.storyPsychology.deeperNeed}`),
    withPeriod(`Fear: ${character.storyPsychology.fear}`),
    withPeriod(`Insecurity: ${character.storyPsychology.insecurity}`),
    withPeriod(`Stress response: ${character.storyPsychology.stressResponse}`),
    withPeriod(`Growth direction: ${character.storyPsychology.growthDirection}`),
    withPeriod(`Teaching roles: ${character.learningFunction.teachingRoles.join(', ')}`),
    withPeriod(`Explanation style: ${character.learningFunction.explanationStyle}`),
  ])

const originAnchor = (character: Character): string => {
  if (!character.origin) {
    return ''
  }

  return joinParts([
    withPeriod(`Birth place: ${character.origin.birthPlace}`),
    withPeriod(`Raised in: ${character.origin.upbringingPlaces.join(', ')}`),
    withPeriod(`Cultural context: ${character.origin.culturalContext.join(', ')}`),
    character.origin.religionOrBelief
      ? withPeriod(`Belief or worldview: ${character.origin.religionOrBelief}`)
      : undefined,
    withPeriod(`Historical context: ${character.origin.historicalContext.join(', ')}`),
    character.origin.notes ? withPeriod(`Origin notes: ${character.origin.notes}`) : undefined,
    'Use origin details as nuanced character-shaping influences, never as crude stereotypes or caricatures.',
  ])
}

const styleAnchor = (): string =>
  `Follow the ${STORYTIME_STYLE_PROFILE.id} style profile. ${describeStorytimeStyleProfile()}`

const whiteBackgroundStyleAnchor = (): string =>
  joinParts([
    withPeriod(`Follow the ${STORYTIME_STYLE_PROFILE.id} style profile for character rendering quality`),
    withPeriod(STORYTIME_STYLE_PROFILE.summary),
    withPeriod(
      `Core style: ${STORYTIME_STYLE_PROFILE.promptFragments.coreStyle}`,
    ),
    withPeriod(
      `Lighting: ${STORYTIME_STYLE_PROFILE.promptFragments.lighting}`,
    ),
    withPeriod(
      'For this white-background UI asset, keep the rendering premium and child-friendly, but do not introduce scene composition, environmental storytelling, fantasy landscape grounding, or scenic background elements',
    ),
    withPeriod(`Guardrails: ${STORYTIME_STYLE_PROFILE.promptFragments.guardrails}`),
  ])

const isEmotionAssetType = (type: string): boolean => type.startsWith('emotion_')
const isWhiteBackgroundAsset = (kind: AssetKind, type: string): boolean =>
  kind === 'standard_figur' || isEmotionAssetType(type)

const emotionPoseInstruction = (type: string): string => {
  if (type === 'emotion_happy') {
    return 'Show unmistakable joy with a wide smile, bright eyes, lifted cheeks, open arms or a small jump, and energetic positive body language. This must not read as neutral.'
  }
  if (type === 'emotion_sad') {
    return 'Show unmistakable sadness with lowered gaze, softened brows, slightly drooped shoulders, slower heavier body language, hands held closer to the body, and a clearly different pose from happy.'
  }
  return 'Use a clearly readable emotional pose that differs strongly from the other emotion assets.'
}

const emotionInstruction = (character: Character, type: string, description: string): string => {
  const emotionLabel = type.replace(/^emotion_/, '').replaceAll('_', ' ')
  return joinParts([
    withPeriod(
      `Keep the same exact character identity as the character reference and show ${character.name} expressing ${emotionLabel}`,
    ),
    withPeriod(
      'Create a full-body or three-quarter character emotion asset on a solid pure white background with no environment props, no scene elements, no floor styling, and no gradient',
    ),
    withPeriod(
      'The silhouette, hands, face, and pose must be clear, anatomically clean, child-friendly, and immediately readable in the UI',
    ),
    withPeriod(emotionPoseInstruction(type)),
    withPeriod(
      `Even in the emotion pose, the ${character.basis.species} identity must stay obvious through face, ears, tail, paw shape, and silhouette`,
    ),
    withPeriod(
      'This emotion asset must look clearly different from the other emotion assets and must not reuse a neutral expression or the same body pose',
    ),
    withPeriod(
      'Use a clean studio-like white background only, keep exactly one character visible, and do not blend in scenic lighting or environmental storytelling',
    ),
    withPeriod(
      type === 'emotion_happy'
        ? 'Prioritize open cheerful energy, lifted posture, and clear delight'
        : 'Prioritize quieter posture, visible vulnerability, lowered energy, and clear sadness',
    ),
    withPeriod(`Target brief: ${description}`),
  ])
}

const assetInstruction = (character: Character, kind: AssetKind, description: string): string => {
  if (kind === 'standard_figur') {
    return joinParts([
      withPeriod(
        `Create a full-body standard character asset of ${character.name} on a solid pure white background`,
      ),
      withPeriod(
        `Show enough of the body to keep the ${character.basis.species} identity unmistakable, including species-specific markings and tail silhouette where applicable`,
      ),
      withPeriod(
        'The pose should feel natural, slightly dynamic, and immediately readable for compositing',
      ),
      withPeriod(
        'Do not show a scene, props, horizon, colored backdrop, gradient, or transparent background; the background must stay clean white only',
      ),
      withPeriod(`Target brief: ${description}`),
    ])
  }

  if (kind === 'hero_image') {
    return joinParts([
      withPeriod(
        `Keep the same exact character identity as the character reference and place ${character.name} in a cinematic story moment`,
      ),
      withPeriod(
        `Treat ${character.name} as the single canonical protagonist: keep the exact same face, hair, colors, outfit cues, and distinctive features as the standard figure`,
      ),
      withPeriod(
        `If the target brief includes other people, they must stay clearly secondary and must never resemble ${character.name} more than ${character.name} does`,
      ),
      withPeriod(
        'Use an immersive fantasy environment with clear foreground, midground, and background separation',
      ),
      withPeriod(`Target brief: ${description}`),
    ])
  }

  if (kind === 'portrait') {
    return joinParts([
      withPeriod(
        `Keep the same exact character identity as the character reference and create a portrait or character card image of ${character.name}`,
      ),
      withPeriod(
        'Frame the face and upper body for strong emotional readability and a clean UI-friendly crop',
      ),
      withPeriod(`Target brief: ${description}`),
    ])
  }

  if (kind === 'profilbild') {
    return joinParts([
      withPeriod(
        `Keep the same exact character identity as the character reference and create a square profile image for ${character.name}`,
      ),
      withPeriod(
        'The face must read instantly at small sizes with a clean silhouette and direct emotional clarity',
      ),
      withPeriod(`Target brief: ${description}`),
    ])
  }

  return joinParts([
    withPeriod(
      `Keep the same exact character identity as the character reference and create an additional character asset for ${character.name}`,
    ),
    withPeriod(`Target brief: ${description}`),
  ])
}

const buildPrompt = (
  character: Character,
  kind: AssetKind,
  description: string,
  type: string,
): string =>
  joinParts([
    baseIdentity(character),
    personalityAnchor(character),
    isWhiteBackgroundAsset(kind, type) ? '' : originAnchor(character),
    isEmotionAssetType(type)
      ? emotionInstruction(character, type, description)
      : assetInstruction(character, kind, description),
    isWhiteBackgroundAsset(kind, type) ? whiteBackgroundStyleAnchor() : styleAnchor(),
    `Hard rules: the character must strictly follow the YAML description, keep child-friendly proportions, preserve the same face shape, eyes, colors, species identity, and distinctive features in every generation. Never drift into another species. Never swap identity with any reference character. ${
      kind === 'hero_image' || kind === 'portrait' || kind === 'profilbild'
        ? `Render ${character.name} as the only primary character in frame; no other person may become the visual focus or share ${character.name}'s defining facial identity.`
        : ''
    } ${
      isWhiteBackgroundAsset(kind, type)
        ? 'This asset must use a solid white background only with no scenery, no transparent background, no gradient, and no environmental props. Ignore birthplace, habitat, forest, meadow, lake, weather, and story-scene details for the background. Do not show trees, leaves, paths, rocks, sky, fog, or any environmental backdrop.'
        : ''
    } ${STORYTIME_STYLE_PROFILE.promptFragments.guardrails}`.trim(),
  ])

const buildResolvedJob = ({
  character,
  kind,
  type,
  label,
  description,
  configuredPath,
  outputRoot,
  seed,
  fileName,
  width,
  height,
  outputFormat,
  mode,
  model,
}: {
  character: Character
  kind: AssetKind
  type: string
  label: string
  description: string
  configuredPath?: string
  outputRoot: string
  seed: number
  fileName: string
  width: number
  height: number
  outputFormat: 'png' | 'jpeg'
  mode: 'text-to-image' | 'image-edit'
  model: FluxModel
}): ResolvedAssetJob => {
  const publicFilePath = resolvePublicFilePath(character, configuredPath, fileName)

  return {
    id: `${character.id}:${type}`,
    kind,
    type,
    label,
    prompt: buildPrompt(character, kind, description, type),
    width,
    height,
    outputFormat,
    mode,
    model,
    outputFilePath: resolveOutputFilePath(outputRoot, publicFilePath),
    publicFilePath,
    fileName: path.basename(publicFilePath),
    description,
    seed,
  }
}

export const buildCharacterAssetJobs = ({
  character,
  outputRoot,
  defaultModel,
  heroModel,
  baseSeed,
  styleReferencePaths = [],
  characterReferencePaths = [],
}: {
  character: Character
  outputRoot: string
  defaultModel: FluxModel
  heroModel: FluxModel
  baseSeed: number
  styleReferencePaths?: string[]
  characterReferencePaths?: string[]
}): ResolvedAssetJob[] => {
  const jobs: ResolvedAssetJob[] = []
  const hasInitialReferenceImages =
    characterReferencePaths.length > 0 || styleReferencePaths.length > 0
  const orderedSpecs = [
    {
      spec: CHARACTER_ASSET_SPECS.standard_figur,
      configuredPath: character.images.standardFigure.file,
      description:
        character.images.standardFigure.description ??
        `${character.name} as a full-body standard figure.`,
      type: 'standard-figur',
    },
    {
      spec: CHARACTER_ASSET_SPECS.hero_image,
      configuredPath: character.images.heroImage.file,
      description:
        character.images.heroImage.description ?? `${character.name} in a cinematic hero scene.`,
      type: 'hero-image',
    },
    {
      spec: CHARACTER_ASSET_SPECS.portrait,
      configuredPath: character.images.portrait.file,
      description:
        character.images.portrait.description ?? `${character.name} as a portrait asset.`,
      type: 'portrait',
    },
    {
      spec: CHARACTER_ASSET_SPECS.profilbild,
      configuredPath: character.images.profileImage.file,
      description:
        character.images.profileImage.description ?? `${character.name} as a profile image.`,
      type: 'profilbild',
    },
  ]

  orderedSpecs.forEach(({ spec, configuredPath, description, type }, index) => {
    jobs.push(
      buildResolvedJob({
        character,
        kind: spec.kind,
        type,
        label: spec.label,
        description,
        configuredPath,
        outputRoot,
        seed: baseSeed + index,
        fileName: spec.defaultFileName,
        width: spec.width,
        height: spec.height,
        outputFormat: spec.outputFormat,
        mode:
          spec.kind === 'standard_figur' && hasInitialReferenceImages
            ? 'image-edit'
            : spec.mode,
        model: spec.useHeroModel ? heroModel : defaultModel,
      }),
    )
  })

  character.images.additionalImages.forEach((image, index) => {
    const spec = additionalAssetSpec(image.type)

    jobs.push(
      buildResolvedJob({
        character,
        kind: 'additional',
        type: image.type,
        label: spec.label,
        description:
          image.description ?? `${character.name} additional asset for ${image.type.replaceAll('_', ' ')}.`,
        configuredPath: image.file,
        outputRoot,
        seed: baseSeed + orderedSpecs.length + index,
        fileName: spec.defaultFileName,
        width: spec.width,
        height: spec.height,
        outputFormat: spec.outputFormat,
        mode: spec.mode,
        model: defaultModel,
      }),
    )
  })

  return jobs
}
