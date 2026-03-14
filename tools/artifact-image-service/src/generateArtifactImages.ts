import path from 'node:path'
import { buildArtifactAssetJobs } from './promptBuilder.ts'
import { loadArtifactFromYaml } from './loadArtifact.ts'
import { writeDownloadedImage, writeManifest } from './assetWriter.ts'
import { STORYTIME_STYLE_PROFILE } from '../../character-image-service/src/storytimeStyleProfile.ts'
import { generateImageWithModel } from '../../../src/server/imageGenerationService.ts'
import type {
  ArtifactAssetGenerationRecord,
  ArtifactGenerationManifest,
  GenerateArtifactImagesOptions,
  ResolvedArtifactAssetJob,
} from './types.ts'

const createPlannedRecord = (job: ResolvedArtifactAssetJob): ArtifactAssetGenerationRecord => ({
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

const recordForSkip = (job: ResolvedArtifactAssetJob, reason: string): ArtifactAssetGenerationRecord => ({
  ...createPlannedRecord(job),
  status: 'skipped',
  reason,
})

const recordForFailure = (
  job: ResolvedArtifactAssetJob,
  reason: string,
): ArtifactAssetGenerationRecord => ({
  ...createPlannedRecord(job),
  status: 'failed',
  reason,
})

const buildManifest = (input: {
  artifactPath: string
  outputRoot: string
  styleReferencePaths: string[]
  artifactReferencePaths: string[]
  defaultModel: GenerateArtifactImagesOptions['defaultModel']
  heroModel: GenerateArtifactImagesOptions['heroModel']
  artifact: Awaited<ReturnType<typeof loadArtifactFromYaml>>
  assets: ArtifactAssetGenerationRecord[]
}): ArtifactGenerationManifest => ({
  generatedAt: new Date().toISOString(),
  generatorVersion: 1,
  styleProfileId: STORYTIME_STYLE_PROFILE.id,
  sourceArtifactPath: input.artifactPath,
  outputDirectory: path.resolve(input.outputRoot, input.artifact.id),
  styleReferencePaths: input.styleReferencePaths,
  artifactReferencePaths: input.artifactReferencePaths,
  models: {
    defaultModel: input.defaultModel,
    heroModel: input.heroModel,
  },
  artifact: input.artifact,
  assets: input.assets,
})

const resolveDefaultStandardReferencePath = (
  outputRoot: string,
  publicPath: string | undefined,
): string | null => {
  if (!publicPath) return null
  const relative = publicPath.replace(/^\/content\/artifacts\//, '')
  return path.resolve(outputRoot, relative)
}

export const generateArtifactImages = async (
  options: GenerateArtifactImagesOptions,
): Promise<{ manifest: ArtifactGenerationManifest; manifestPath: string }> => {
  const artifact = await loadArtifactFromYaml(options.artifactPath)
  const jobs = buildArtifactAssetJobs({
    artifact,
    outputRoot: options.outputRoot,
    defaultModel: options.defaultModel,
    heroModel: options.heroModel,
    baseSeed: options.baseSeed,
  })

  const assetRecords: ArtifactAssetGenerationRecord[] = []
  let standardArtifactReferencePath = resolveDefaultStandardReferencePath(
    options.outputRoot,
    artifact.images.standardArtifact.file,
  )

  options.onProgress?.({
    type: 'planned',
    assets: jobs.map((job) => createPlannedRecord(job)),
  })

  if (options.dryRun) {
    const manifest = buildManifest({
      artifactPath: options.artifactPath,
      outputRoot: options.outputRoot,
      styleReferencePaths: options.styleReferencePaths,
      artifactReferencePaths: options.artifactReferencePaths ?? [],
      defaultModel: options.defaultModel,
      heroModel: options.heroModel,
      artifact,
      assets: jobs.map((job) => createPlannedRecord(job)),
    })
    const manifestPath = await writeManifest({
      manifest,
      outputDirectory: path.resolve(options.outputRoot, artifact.id),
    })
    options.onProgress?.({ type: 'completed', manifest, manifestPath })
    return { manifest, manifestPath }
  }

  for (const job of jobs) {
    const referenceImagePaths =
      job.kind === 'standard_artifact'
        ? [...(options.artifactReferencePaths ?? []), ...options.styleReferencePaths]
        : [
            standardArtifactReferencePath,
            ...(options.artifactReferencePaths ?? []),
            ...options.styleReferencePaths,
          ].filter((value): value is string => Boolean(value))

    if (job.mode === 'image-edit' && referenceImagePaths.length === 0) {
      const skippedRecord = recordForSkip(job, 'No reference images available for image-edit mode')
      assetRecords.push(skippedRecord)
      options.onProgress?.({ type: 'asset-finished', asset: skippedRecord })
      continue
    }

    options.onProgress?.({ type: 'asset-started', asset: job })

    try {
      const result = await generateImageWithModel({
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

      const writeStatus = await writeDownloadedImage({
        sourceUrl: result.imageUrl,
        outputFilePath: job.outputFilePath,
        overwrite: options.overwrite,
      })

      const record: ArtifactAssetGenerationRecord = {
        ...createPlannedRecord(job),
        status: writeStatus === 'written' ? 'generated' : 'skipped',
        requestId: result.requestId,
        sampleUrl: result.imageUrl,
        cost: result.cost,
        reason: writeStatus === 'skipped' ? 'File already exists and overwrite=false' : undefined,
      }

      assetRecords.push(record)
      options.onProgress?.({ type: 'asset-finished', asset: record })

      if (job.kind === 'standard_artifact' && writeStatus === 'written') {
        standardArtifactReferencePath = job.outputFilePath
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failureRecord = recordForFailure(job, message)
      assetRecords.push(failureRecord)
      options.onProgress?.({ type: 'failed', message: `Generation failed for ${job.type}: ${message}` })
      options.onProgress?.({ type: 'asset-finished', asset: failureRecord })
    }
  }

  const manifest = buildManifest({
    artifactPath: options.artifactPath,
    outputRoot: options.outputRoot,
    styleReferencePaths: options.styleReferencePaths,
    artifactReferencePaths: options.artifactReferencePaths ?? [],
    defaultModel: options.defaultModel,
    heroModel: options.heroModel,
    artifact,
    assets: assetRecords,
  })

  const manifestPath = await writeManifest({
    manifest,
    outputDirectory: path.resolve(options.outputRoot, artifact.id),
  })

  const failedAssetCount = assetRecords.filter((asset) => asset.status === 'failed').length
  if (failedAssetCount > 0) {
    options.onProgress?.({
      type: 'failed',
      message: `${failedAssetCount} Asset(s) konnten nicht erzeugt werden. Siehe Manifest fuer Details.`,
    })
  }
  options.onProgress?.({ type: 'completed', manifest, manifestPath })

  return { manifest, manifestPath }
}
