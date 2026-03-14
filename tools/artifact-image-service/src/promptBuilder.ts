import path from 'node:path'
import type { Artifact } from '../../../src/content/types.ts'
import {
  STORYTIME_STYLE_PROFILE,
  describeStorytimeStyleProfile,
} from '../../character-image-service/src/storytimeStyleProfile.ts'
import type { ArtifactAssetKind, ArtifactAssetSpec, FluxModel, ResolvedArtifactAssetJob } from './types.ts'

const ARTIFACT_ASSET_SPECS: Record<ArtifactAssetKind, ArtifactAssetSpec> = {
  standard_artifact: {
    kind: 'standard_artifact',
    label: 'Standard Artifact',
    width: 1024,
    height: 1024,
    outputFormat: 'png',
    defaultFileName: 'standard-artifact.png',
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
}

const withPeriod = (value: string): string => `${value.trim().replace(/[.?!]+$/g, '')}.`

const joinParts = (parts: Array<string | undefined>): string => parts.filter(Boolean).join(' ')

const normalizePathSlashes = (value: string): string => value.replace(/\\/g, '/')

const resolvePublicFilePath = (
  artifact: Artifact,
  configuredPath: string | undefined,
  fileName: string,
): string => {
  if (!configuredPath) {
    return `/content/artifacts/${artifact.id}/${fileName}`
  }

  if (configuredPath.startsWith('/')) {
    return configuredPath
  }

  return `/content/artifacts/${artifact.id}/${configuredPath}`
}

const resolveOutputFilePath = (outputRoot: string, publicFilePath: string): string => {
  const normalized = normalizePathSlashes(publicFilePath)
  const relative = normalized.startsWith('/content/artifacts/')
    ? normalized.slice('/content/artifacts/'.length)
    : normalized.replace(/^\/+/, '')
  return path.resolve(outputRoot, relative)
}

const artifactIdentity = (artifact: Artifact): string =>
  joinParts([
    withPeriod(`Artifact name: ${artifact.name}`),
    withPeriod(`Artifact type: ${artifact.artifactType}`),
    withPeriod(`Description: ${artifact.description}`),
    withPeriod(`Form: ${artifact.appearance.form}`),
    artifact.appearance.size ? withPeriod(`Size: ${artifact.appearance.size}`) : undefined,
    withPeriod(`Materials: ${artifact.appearance.materials.join(', ')}`),
    withPeriod(`Colors: ${artifact.appearance.colors.join(', ')}`),
    withPeriod(`Condition: ${artifact.appearance.condition}`),
    withPeriod(`Distinctive features: ${artifact.appearance.distinctiveFeatures.join(', ')}`),
  ])

const artifactFunctionAnchor = (artifact: Artifact): string =>
  joinParts([
    withPeriod(`Primary purpose: ${artifact.function.primaryPurpose}`),
    artifact.function.secondaryPurposes.length > 0
      ? withPeriod(`Secondary purposes: ${artifact.function.secondaryPurposes.join(', ')}`)
      : undefined,
    artifact.function.activation
      ? withPeriod(`Activation: ${artifact.function.activation}`)
      : undefined,
    withPeriod(`Effects: ${artifact.function.effects.join(', ')}`),
    artifact.function.limitations.length > 0
      ? withPeriod(`Limitations: ${artifact.function.limitations.join(', ')}`)
      : undefined,
  ])

const artifactOptionalAnchors = (artifact: Artifact): string =>
  joinParts([
    artifact.sensoryProfile?.sound
      ? withPeriod(`Sound impression: ${artifact.sensoryProfile.sound}`)
      : undefined,
    artifact.sensoryProfile?.scent
      ? withPeriod(`Scent impression: ${artifact.sensoryProfile.scent}`)
      : undefined,
    artifact.sensoryProfile?.texture
      ? withPeriod(`Texture impression: ${artifact.sensoryProfile.texture}`)
      : undefined,
    artifact.sensoryProfile?.aura
      ? withPeriod(`Aura: ${artifact.sensoryProfile.aura}`)
      : undefined,
    artifact.origin?.creator ? withPeriod(`Creator: ${artifact.origin.creator}`) : undefined,
    artifact.origin?.era ? withPeriod(`Era: ${artifact.origin.era}`) : undefined,
    artifact.origin?.culturalContext
      ? withPeriod(`Cultural context: ${artifact.origin.culturalContext}`)
      : undefined,
    artifact.origin && artifact.origin.inscriptions.length > 0
      ? withPeriod(`Inscriptions: ${artifact.origin.inscriptions.join(', ')}`)
      : undefined,
    artifact.tags.length > 0 ? withPeriod(`Tags: ${artifact.tags.join(', ')}`) : undefined,
  ])

const styleAnchor = (): string =>
  `Follow the ${STORYTIME_STYLE_PROFILE.id} style profile. ${describeStorytimeStyleProfile()}`

const assetInstruction = (artifact: Artifact, kind: ArtifactAssetKind, description: string): string => {
  if (kind === 'standard_artifact') {
    return joinParts([
      withPeriod(`Render ${artifact.name} as a single isolated artifact on a pure white background`),
      withPeriod(
        'No environment, no floor, no gradients, no transparent background, no extra props, and no character in frame',
      ),
      withPeriod('The silhouette must be crisp and highly readable for UI compositing'),
      withPeriod(`Target brief: ${description}`),
    ])
  }

  if (kind === 'hero_image') {
    return joinParts([
      withPeriod(
        `Render ${artifact.name} as the singular visual protagonist of a cinematic story moment in a child-friendly fantasy world`,
      ),
      withPeriod(
        `Keep the exact same artifact identity, material qualities, color palette, and distinctive features as ${artifact.name} in the standard artifact image`,
      ),
      withPeriod('No secondary object may steal focus from the artifact'),
      withPeriod(`Target brief: ${description}`),
    ])
  }

  return joinParts([
    withPeriod(
      `Create a portrait card image of ${artifact.name} with strong close-up readability and clean framing`,
    ),
    withPeriod(
      'Preserve identity exactly: same shape language, materials, colors, and distinctive markings as the standard artifact',
    ),
    withPeriod(`Target brief: ${description}`),
  ])
}

const buildPrompt = (artifact: Artifact, kind: ArtifactAssetKind, description: string): string =>
  joinParts([
    artifactIdentity(artifact),
    artifactFunctionAnchor(artifact),
    artifactOptionalAnchors(artifact),
    assetInstruction(artifact, kind, description),
    styleAnchor(),
    `Hard rules: Keep ${artifact.name} visually identical across all generated assets. Keep child-friendly style and clear readability. No horror, no photoreal uncanny style, no violent framing, and no brand/IP references. ${
      kind === 'standard_artifact'
        ? 'Use a solid pure white background only.'
        : 'Allow cinematic environments but keep the artifact as the only primary focus.'
    }`,
  ])

const buildResolvedJob = ({
  artifact,
  kind,
  description,
  configuredPath,
  outputRoot,
  seed,
  spec,
  model,
}: {
  artifact: Artifact
  kind: ArtifactAssetKind
  description: string
  configuredPath?: string
  outputRoot: string
  seed: number
  spec: ArtifactAssetSpec
  model: FluxModel
}): ResolvedArtifactAssetJob => {
  const publicFilePath = resolvePublicFilePath(artifact, configuredPath, spec.defaultFileName)

  return {
    id: `${artifact.id}:${kind}`,
    kind,
    type: kind,
    label: spec.label,
    prompt: buildPrompt(artifact, kind, description),
    width: spec.width,
    height: spec.height,
    outputFormat: spec.outputFormat,
    mode: spec.mode,
    model,
    outputFilePath: resolveOutputFilePath(outputRoot, publicFilePath),
    publicFilePath,
    fileName: path.basename(publicFilePath),
    description,
    seed,
  }
}

export const buildArtifactAssetJobs = ({
  artifact,
  outputRoot,
  defaultModel,
  heroModel,
  baseSeed,
}: {
  artifact: Artifact
  outputRoot: string
  defaultModel: FluxModel
  heroModel: FluxModel
  baseSeed: number
}): ResolvedArtifactAssetJob[] => {
  const orderedKinds: ArtifactAssetKind[] = ['standard_artifact', 'hero_image', 'portrait']
  return orderedKinds.map((kind, index) => {
    const spec = ARTIFACT_ASSET_SPECS[kind]
    const imageConfig =
      kind === 'standard_artifact'
        ? artifact.images.standardArtifact
        : kind === 'hero_image'
          ? artifact.images.heroImage
          : artifact.images.portrait

    const fallbackDescription =
      kind === 'standard_artifact'
        ? `${artifact.name} as a clean standard artifact render.`
        : kind === 'hero_image'
          ? `${artifact.name} in a cinematic hero scene.`
          : `${artifact.name} as a portrait card render.`

    return buildResolvedJob({
      artifact,
      kind,
      description: imageConfig.description ?? fallbackDescription,
      configuredPath: imageConfig.file,
      outputRoot,
      seed: baseSeed + index,
      spec,
      model: spec.useHeroModel ? heroModel : defaultModel,
    })
  })
}
