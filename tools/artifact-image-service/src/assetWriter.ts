import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ArtifactGenerationManifest } from './types.ts'

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export const ensureDirectoryForFile = async (filePath: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true })
}

export const writeDownloadedImage = async ({
  sourceUrl,
  outputFilePath,
  overwrite,
}: {
  sourceUrl: string
  outputFilePath: string
  overwrite: boolean
}): Promise<'written' | 'skipped'> => {
  if (!overwrite && (await exists(outputFilePath))) {
    return 'skipped'
  }

  await ensureDirectoryForFile(outputFilePath)
  const response = await fetch(sourceUrl)
  if (!response.ok) {
    throw new Error(`Could not download generated image (${response.status}) from ${sourceUrl}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  await writeFile(outputFilePath, Buffer.from(arrayBuffer))
  return 'written'
}

export const writeManifest = async ({
  manifest,
  outputDirectory,
}: {
  manifest: ArtifactGenerationManifest
  outputDirectory: string
}): Promise<string> => {
  const manifestPath = path.resolve(outputDirectory, 'generation-manifest.json')
  await mkdir(outputDirectory, { recursive: true })
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  return manifestPath
}
