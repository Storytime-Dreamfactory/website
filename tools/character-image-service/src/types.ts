import type { Character } from '../../../src/content/types.ts'

export type FluxModel =
  | 'flux-2-pro-preview'
  | 'flux-2-pro'
  | 'flux-2-max'
  | 'flux-2-flex'
  | 'flux-2-klein-4b'
  | 'flux-2-klein-9b'

export type AssetKind =
  | 'standard_figur'
  | 'hero_image'
  | 'portrait'
  | 'profilbild'
  | 'additional'

export type AssetMode = 'text-to-image' | 'image-edit'

export type CharacterAssetSpec = {
  kind: AssetKind
  label: string
  width: number
  height: number
  outputFormat: 'png' | 'jpeg'
  defaultFileName: string
  mode: AssetMode
  useHeroModel?: boolean
}

export type ResolvedAssetJob = {
  id: string
  kind: AssetKind
  type: string
  label: string
  prompt: string
  width: number
  height: number
  outputFormat: 'png' | 'jpeg'
  mode: AssetMode
  model: FluxModel
  outputFilePath: string
  publicFilePath: string
  fileName: string
  description: string
  seed: number
}

export type FluxCreateResponse = {
  id: string
  polling_url: string
  cost?: number
  input_mp?: number
  output_mp?: number
}

export type FluxPollResult =
  | {
      status: 'Ready'
      result: {
        sample: string
      }
    }
  | {
      status: 'Pending' | 'Processing' | 'Queued'
    }
  | {
      status: 'Error' | 'Failed'
      error?: string
      details?: unknown
    }

export type AssetGenerationRecord = {
  id: string
  type: string
  kind: AssetKind
  status: 'generated' | 'skipped' | 'planned' | 'running' | 'failed'
  mode: AssetMode
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
  pollingUrl?: string
  sampleUrl?: string
  cost?: number
  reason?: string
}

export type GenerationProgressEvent =
  | {
      type: 'planned'
      assets: AssetGenerationRecord[]
    }
  | {
      type: 'asset-started'
      asset: ResolvedAssetJob
    }
  | {
      type: 'asset-finished'
      asset: AssetGenerationRecord
    }
  | {
      type: 'completed'
      manifest: GenerationManifest
      manifestPath: string
    }
  | {
      type: 'failed'
      message: string
    }

export type GenerationManifest = {
  generatedAt: string
  generatorVersion: number
  styleProfileId: string
  sourceCharacterPath: string
  outputDirectory: string
  styleReferencePaths: string[]
  characterReferencePaths: string[]
  models: {
    defaultModel: FluxModel
    heroModel: FluxModel
  }
  character: Character
  assets: AssetGenerationRecord[]
}

export type GenerateCharacterImagesOptions = {
  characterPath: string
  outputRoot: string
  styleReferencePaths: string[]
  characterReferencePaths?: string[]
  defaultModel: FluxModel
  heroModel: FluxModel
  dryRun: boolean
  overwrite: boolean
  baseSeed: number
  pollIntervalMs: number
  maxPollAttempts: number
  onProgress?: (event: GenerationProgressEvent) => void
}
