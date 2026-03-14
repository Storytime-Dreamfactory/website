import type { Artifact, ContentManifest } from '../../../src/content/types.ts'

export type FluxModel =
  | 'flux-2-pro-preview'
  | 'flux-2-pro'
  | 'flux-2-max'
  | 'flux-2-flex'
  | 'flux-2-klein-4b'
  | 'flux-2-klein-9b'

export type ArtifactAssetKind = 'standard_artifact' | 'hero_image' | 'portrait'

export type ArtifactAssetSpec = {
  kind: ArtifactAssetKind
  label: string
  width: number
  height: number
  outputFormat: 'png' | 'jpeg'
  defaultFileName: string
  mode: 'text-to-image' | 'image-edit'
  useHeroModel?: boolean
}

export type ResolvedArtifactAssetJob = {
  id: string
  kind: ArtifactAssetKind
  type: ArtifactAssetKind
  label: string
  prompt: string
  width: number
  height: number
  outputFormat: 'png' | 'jpeg'
  mode: 'text-to-image' | 'image-edit'
  model: FluxModel
  outputFilePath: string
  publicFilePath: string
  fileName: string
  description: string
  seed: number
}

export type ArtifactAssetGenerationRecord = {
  id: string
  type: ArtifactAssetKind
  kind: ArtifactAssetKind
  status: 'generated' | 'skipped' | 'planned' | 'running' | 'failed'
  mode: 'text-to-image' | 'image-edit'
  model: FluxModel
  prompt: string
  description: string
  publicFilePath: string
  outputFilePath: string
  width: number
  height: number
  outputFormat: 'png' | 'jpeg'
  seed: number
  requestId?: string
  sampleUrl?: string
  cost?: number
  reason?: string
}

export type ArtifactGenerationManifest = {
  generatedAt: string
  generatorVersion: number
  styleProfileId: string
  sourceArtifactPath: string
  outputDirectory: string
  styleReferencePaths: string[]
  artifactReferencePaths: string[]
  models: {
    defaultModel: FluxModel
    heroModel: FluxModel
  }
  artifact: Artifact
  assets: ArtifactAssetGenerationRecord[]
}

export type GenerateArtifactImagesOptions = {
  artifactPath: string
  outputRoot: string
  styleReferencePaths: string[]
  artifactReferencePaths?: string[]
  defaultModel: FluxModel
  heroModel: FluxModel
  dryRun: boolean
  overwrite: boolean
  baseSeed: number
  pollIntervalMs: number
  maxPollAttempts: number
  onProgress?: (event: ArtifactGenerationProgressEvent) => void
}

export type ArtifactGenerationProgressEvent =
  | {
      type: 'planned'
      assets: ArtifactAssetGenerationRecord[]
    }
  | {
      type: 'asset-started'
      asset: ResolvedArtifactAssetJob
    }
  | {
      type: 'asset-finished'
      asset: ArtifactAssetGenerationRecord
    }
  | {
      type: 'completed'
      manifest: ArtifactGenerationManifest
      manifestPath: string
    }
  | {
      type: 'failed'
      message: string
    }

export type ArtifactBatchOptions = Omit<GenerateArtifactImagesOptions, 'artifactPath'> & {
  contentManifestPath: string
}

export type ArtifactBatchResult = {
  contentManifestPath: string
  artifactCount: number
  generatedAt: string
  artifacts: Array<{
    artifactPath: string
    manifestPath?: string
    ok: boolean
    error?: string
  }>
}

export type ManifestLoader = (path: string) => Promise<ContentManifest>
