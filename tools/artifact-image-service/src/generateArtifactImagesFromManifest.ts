import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateArtifactImages } from './generateArtifactImages.ts'
import { readContentManifest } from './contentManifest.ts'
import type { ArtifactBatchResult, GenerateArtifactImagesOptions } from './types.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

const toAbsoluteWorkspacePath = (runtimePath: string): string =>
  path.resolve(workspaceRoot, runtimePath.replace(/^\/+/, ''))

export const generateArtifactImagesFromManifest = async (input: {
  contentManifestPath: string
  outputRoot: string
  styleReferencePaths: string[]
  artifactReferencePaths?: string[]
  defaultModel: GenerateArtifactImagesOptions['defaultModel']
  heroModel: GenerateArtifactImagesOptions['heroModel']
  dryRun: boolean
  overwrite: boolean
  baseSeed: number
  pollIntervalMs: number
  maxPollAttempts: number
  onArtifactCompleted?: (event: { artifactPath: string; ok: boolean; message?: string }) => void
}): Promise<ArtifactBatchResult> => {
  const manifest = await readContentManifest(input.contentManifestPath)
  const artifacts = manifest.artifacts
  const results: ArtifactBatchResult['artifacts'] = []

  for (let index = 0; index < artifacts.length; index += 1) {
    const artifactRuntimePath = artifacts[index]!
    const artifactPath = toAbsoluteWorkspacePath(artifactRuntimePath)

    try {
      const { manifestPath } = await generateArtifactImages({
        artifactPath,
        outputRoot: input.outputRoot,
        styleReferencePaths: input.styleReferencePaths,
        artifactReferencePaths: input.artifactReferencePaths ?? [],
        defaultModel: input.defaultModel,
        heroModel: input.heroModel,
        dryRun: input.dryRun,
        overwrite: input.overwrite,
        baseSeed: input.baseSeed + index * 100,
        pollIntervalMs: input.pollIntervalMs,
        maxPollAttempts: input.maxPollAttempts,
      })
      results.push({ artifactPath, manifestPath, ok: true })
      input.onArtifactCompleted?.({ artifactPath, ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({ artifactPath, ok: false, error: message })
      input.onArtifactCompleted?.({ artifactPath, ok: false, message })
    }
  }

  return {
    contentManifestPath: path.resolve(input.contentManifestPath),
    artifactCount: artifacts.length,
    generatedAt: new Date().toISOString(),
    artifacts: results,
  }
}
