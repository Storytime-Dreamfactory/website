import path from 'node:path'
import type { Character } from '../../../src/content/types.ts'
import { STORYTIME_STYLE_PROFILE, describeStorytimeStyleProfile } from './storytimeStyleProfile.ts'
import type { AssetKind, CharacterAssetSpec, FluxModel, ResolvedAssetJob } from './types.ts'

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
  label: `Additional Asset (${type})`,
  width: 1024,
  height: 1024,
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

const assetInstruction = (character: Character, kind: AssetKind, description: string): string => {
  if (kind === 'standard_figur') {
    return joinParts([
      withPeriod(
        `Create a full-body hero asset of ${character.name} on a transparent or visually clean isolated background`,
      ),
      withPeriod(
        'The pose should feel natural, slightly dynamic, and immediately readable for compositing',
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

const buildPrompt = (character: Character, kind: AssetKind, description: string): string =>
  joinParts([
    baseIdentity(character),
    personalityAnchor(character),
    originAnchor(character),
    assetInstruction(character, kind, description),
    styleAnchor(),
    `Hard rules: the character must strictly follow the YAML description, keep child-friendly proportions, preserve the same face shape, eyes, colors, and distinctive features in every generation. ${STORYTIME_STYLE_PROFILE.promptFragments.guardrails}`,
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
    prompt: buildPrompt(character, kind, description),
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
}: {
  character: Character
  outputRoot: string
  defaultModel: FluxModel
  heroModel: FluxModel
  baseSeed: number
}): ResolvedAssetJob[] => {
  const jobs: ResolvedAssetJob[] = []
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
        mode: spec.mode,
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
