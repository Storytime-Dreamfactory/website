import path from 'node:path'
import { buildCharacterAssetJobs } from './promptBuilder.ts'
import { FluxClient } from './fluxClient.ts'
import { loadCharacterFromYaml } from './loadCharacter.ts'
import { writeDownloadedImage, writeManifest } from './assetWriter.ts'
import { STORYTIME_STYLE_PROFILE } from './storytimeStyleProfile.ts'
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

const resolveReferenceImages = (
  job: ResolvedAssetJob,
  standardFigurePath: string | null,
  styleReferencePaths: string[],
): string[] => {
  if (job.kind === 'standard_figur') {
    return styleReferencePaths
  }

  return [standardFigurePath, ...styleReferencePaths].filter((value): value is string => Boolean(value))
}

const buildManifest = (input: {
  characterPath: string
  outputRoot: string
  styleReferencePaths: string[]
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

  const apiKey = process.env.BFL_API_KEY
  if (!apiKey) {
    const message = 'BFL_API_KEY is required for image generation'
    options.onProgress?.({ type: 'failed', message })
    throw new Error(message)
  }

  const fluxClient = new FluxClient(apiKey)

  for (const job of jobs) {
    const referenceImagePaths = resolveReferenceImages(
      job,
      standardFigureReferencePath,
      options.styleReferencePaths,
    )

    if (job.mode === 'image-edit' && referenceImagePaths.length === 0) {
      const skippedRecord = recordForSkip(job, 'No reference images available for image-edit mode')
      assetRecords.push(skippedRecord)
      options.onProgress?.({ type: 'asset-finished', asset: skippedRecord })
      continue
    }

    options.onProgress?.({ type: 'asset-started', asset: job })

    const request =
      job.mode === 'text-to-image'
        ? await fluxClient.generateTextToImage({
            model: job.model,
            prompt: job.prompt,
            width: job.width,
            height: job.height,
            outputFormat: job.outputFormat,
            seed: job.seed,
          })
        : await fluxClient.editImage({
            model: job.model,
            prompt: job.prompt,
            width: job.width,
            height: job.height,
            outputFormat: job.outputFormat,
            seed: job.seed,
            referenceImagePaths,
          })

    const pollResult = await fluxClient.pollResult({
      pollingUrl: request.polling_url,
      pollIntervalMs: options.pollIntervalMs,
      maxAttempts: options.maxPollAttempts,
    })

    if (pollResult.status !== 'Ready') {
      const errorMessage = 'error' in pollResult ? pollResult.error : undefined
      const message = `Generation failed for ${job.type}: ${errorMessage ?? 'Unknown FLUX error'}`
      options.onProgress?.({ type: 'failed', message })
      throw new Error(message)
    }

    const writeStatus = await writeDownloadedImage({
      sourceUrl: pollResult.result.sample,
      outputFilePath: job.outputFilePath,
      overwrite: options.overwrite,
    })

    const record: AssetGenerationRecord = {
      ...createPlannedRecord(job),
      status: writeStatus === 'written' ? 'generated' : 'skipped',
      requestId: request.id,
      pollingUrl: request.polling_url,
      sampleUrl: pollResult.result.sample,
      cost: request.cost,
      reason: writeStatus === 'skipped' ? 'File already exists and overwrite=false' : undefined,
    }

    assetRecords.push(record)
    options.onProgress?.({ type: 'asset-finished', asset: record })

    if (job.kind === 'standard_figur' && writeStatus === 'written') {
      standardFigureReferencePath = job.outputFilePath
    }
  }

  const manifest = buildManifest({
    characterPath: options.characterPath,
    outputRoot: options.outputRoot,
    styleReferencePaths: options.styleReferencePaths,
    defaultModel: options.defaultModel,
    heroModel: options.heroModel,
    character,
    assets: assetRecords,
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
