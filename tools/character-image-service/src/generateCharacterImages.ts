import path from 'node:path'
import { buildCharacterAssetJobs } from './promptBuilder.ts'
import { loadCharacterFromYaml } from './loadCharacter.ts'
import { writeDownloadedImage, writeManifest } from './assetWriter.ts'
import { STORYTIME_STYLE_PROFILE } from './storytimeStyleProfile.ts'
import { generateImageWithModel } from '../../../src/server/imageGenerationService.ts'
import type {
  AssetGenerationRecord,
  GenerateCharacterImagesOptions,
  GenerationManifest,
  ResolvedAssetJob,
} from './types.ts'

const createPlannedRecord = (job: ResolvedAssetJob): AssetGenerationRecord => ({
  id: job.id,
  type: job.type,
  kind: job.kind,
  status: 'planned',
  mode: job.mode,
  model: job.model,
  prompt: job.prompt,
  description: job.description,
  publicFilePath: job.publicFilePath,
  outputFilePath: job.outputFilePath,
  width: job.width,
  height: job.height,
  outputFormat: job.outputFormat,
  seed: job.seed,
})

const recordForSkip = (job: ResolvedAssetJob, reason: string): AssetGenerationRecord => ({
  ...createPlannedRecord(job),
  status: 'skipped',
  reason,
})

const recordForFailure = (job: ResolvedAssetJob, reason: string): AssetGenerationRecord => ({
  ...createPlannedRecord(job),
  status: 'failed',
  reason,
})

const resolveReferenceImages = (
  job: ResolvedAssetJob,
  standardFigurePath: string | null,
  styleReferencePaths: string[],
  characterReferencePaths: string[],
): string[] => {
  if (job.kind === 'standard_figur') {
    return [...characterReferencePaths]
  }

  if (job.type.startsWith('emotion_')) {
    if (standardFigurePath) {
      return [standardFigurePath]
    }
    return [...characterReferencePaths]
  }

  return [standardFigurePath, ...characterReferencePaths, ...styleReferencePaths].filter(
    (value): value is string => Boolean(value),
  )
}

const buildManifest = (input: {
  characterPath: string
  outputRoot: string
  styleReferencePaths: string[]
  characterReferencePaths: string[]
  defaultModel: GenerateCharacterImagesOptions['defaultModel']
  heroModel: GenerateCharacterImagesOptions['heroModel']
  character: Awaited<ReturnType<typeof loadCharacterFromYaml>>
  assets: AssetGenerationRecord[]
}): GenerationManifest => ({
  generatedAt: new Date().toISOString(),
  generatorVersion: 1,
  styleProfileId: STORYTIME_STYLE_PROFILE.id,
  sourceCharacterPath: input.characterPath,
  outputDirectory: path.resolve(input.outputRoot, input.character.id),
  styleReferencePaths: input.styleReferencePaths,
  characterReferencePaths: input.characterReferencePaths,
  models: {
    defaultModel: input.defaultModel,
    heroModel: input.heroModel,
  },
  character: input.character,
  assets: input.assets,
})

export const generateCharacterImages = async (
  options: GenerateCharacterImagesOptions,
): Promise<{ manifest: GenerationManifest; manifestPath: string }> => {
  const character = await loadCharacterFromYaml(options.characterPath)
  const jobs = buildCharacterAssetJobs({
    character,
    outputRoot: options.outputRoot,
    defaultModel: options.defaultModel,
    heroModel: options.heroModel,
    baseSeed: options.baseSeed,
    styleReferencePaths: options.styleReferencePaths,
    characterReferencePaths: options.characterReferencePaths ?? [],
  })

  const assetRecords: AssetGenerationRecord[] = []
  let standardFigureReferencePath: string | null = null

  if (character.images.standardFigure.file) {
    standardFigureReferencePath = path.resolve(
      options.outputRoot,
      character.images.standardFigure.file.replace(/^\/content\/characters\//, ''),
    )
  }

  options.onProgress?.({
    type: 'planned',
    assets: jobs.map((job) => createPlannedRecord(job)),
  })

  if (options.dryRun) {
    const manifest = buildManifest({
      characterPath: options.characterPath,
      outputRoot: options.outputRoot,
      styleReferencePaths: options.styleReferencePaths,
      characterReferencePaths: options.characterReferencePaths ?? [],
      defaultModel: options.defaultModel,
      heroModel: options.heroModel,
      character,
      assets: jobs.map((job) => createPlannedRecord(job)),
    })

    const manifestPath = await writeManifest({
      manifest,
      outputDirectory: path.resolve(options.outputRoot, character.id),
    })

    options.onProgress?.({
      type: 'completed',
      manifest,
      manifestPath,
    })

    return { manifest, manifestPath }
  }

  const runAssetWithRetry = async (
    job: ResolvedAssetJob,
    referenceImagePaths: string[],
  ): Promise<Awaited<ReturnType<typeof generateImageWithModel>>> => {
    const maxAttempts = 2
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await generateImageWithModel({
          model: job.model,
          prompt: job.prompt,
          width: job.width,
          height: job.height,
          outputFormat: job.outputFormat,
          seed: job.seed,
          pollIntervalMs: options.pollIntervalMs,
          maxPollAttempts: options.maxPollAttempts,
          referenceImagePaths: job.mode === 'image-edit' ? referenceImagePaths : undefined,
        })
      } catch (error) {
        lastError = error
        if (attempt < maxAttempts) {
          const message = error instanceof Error ? error.message : String(error)
          options.onProgress?.({
            type: 'failed',
            message: `Retry ${attempt}/${maxAttempts - 1} fuer ${job.type}: ${message}`,
          })
        }
      }
    }
    throw lastError
  }

  for (const job of jobs) {
    const referenceImagePaths = resolveReferenceImages(
      job,
      standardFigureReferencePath,
      options.styleReferencePaths,
      options.characterReferencePaths ?? [],
    )

    if (job.mode === 'image-edit' && referenceImagePaths.length === 0) {
      const skippedRecord = recordForSkip(job, 'No reference images available for image-edit mode')
      assetRecords.push(skippedRecord)
      options.onProgress?.({ type: 'asset-finished', asset: skippedRecord })
      continue
    }

    options.onProgress?.({ type: 'asset-started', asset: job })

    try {
      const result = await runAssetWithRetry(job, referenceImagePaths)
      const writeStatus = await writeDownloadedImage({
        sourceUrl: result.imageUrl,
        outputFilePath: job.outputFilePath,
        overwrite: options.overwrite,
      })

      const record: AssetGenerationRecord = {
        ...createPlannedRecord(job),
        status: writeStatus === 'written' ? 'generated' : 'skipped',
        requestId: result.requestId,
        sampleUrl: result.imageUrl,
        cost: result.cost,
        reason: writeStatus === 'skipped' ? 'File already exists and overwrite=false' : undefined,
      }

      assetRecords.push(record)
      options.onProgress?.({ type: 'asset-finished', asset: record })

      if (job.kind === 'standard_figur' && writeStatus === 'written') {
        standardFigureReferencePath = job.outputFilePath
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const failureRecord = recordForFailure(job, errorMessage)
      assetRecords.push(failureRecord)
      options.onProgress?.({
        type: 'failed',
        message: `Generation failed for ${job.type}: ${errorMessage}`,
      })
      options.onProgress?.({ type: 'asset-finished', asset: failureRecord })
    }
  }

  const manifest = buildManifest({
    characterPath: options.characterPath,
    outputRoot: options.outputRoot,
    styleReferencePaths: options.styleReferencePaths,
    characterReferencePaths: options.characterReferencePaths ?? [],
    defaultModel: options.defaultModel,
    heroModel: options.heroModel,
    character,
    assets: assetRecords,
  })

  const manifestPath = await writeManifest({
    manifest,
    outputDirectory: path.resolve(options.outputRoot, character.id),
  })

  const failedAssetCount = assetRecords.filter((asset) => asset.status === 'failed').length
  if (failedAssetCount > 0) {
    options.onProgress?.({
      type: 'failed',
      message: `${failedAssetCount} Asset(s) konnten nicht erzeugt werden. Siehe Manifest fuer Details.`,
    })
  }
  options.onProgress?.({
    type: 'completed',
    manifest,
    manifestPath,
  })

  return { manifest, manifestPath }
}
