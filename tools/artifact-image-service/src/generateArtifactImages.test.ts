import { describe, expect, it, vi } from 'vitest'

const loadArtifactFromYamlMock = vi.hoisted(() => vi.fn())
const buildArtifactAssetJobsMock = vi.hoisted(() => vi.fn())
const writeManifestMock = vi.hoisted(() => vi.fn())

vi.mock('./loadArtifact.ts', () => ({
  loadArtifactFromYaml: loadArtifactFromYamlMock,
}))

vi.mock('./promptBuilder.ts', () => ({
  buildArtifactAssetJobs: buildArtifactAssetJobsMock,
}))

vi.mock('./assetWriter.ts', () => ({
  writeDownloadedImage: vi.fn(),
  writeManifest: writeManifestMock,
}))

vi.mock('../../../src/server/imageGenerationService.ts', () => ({
  generateImageWithModel: vi.fn(),
}))

import { generateArtifactImages } from './generateArtifactImages.ts'

describe('generateArtifactImages', () => {
  it('liefert im dry-run alle geplanten Pflichtassets im Manifest', async () => {
    loadArtifactFromYamlMock.mockResolvedValue({
      id: 'artifact-id',
      images: {
        standardArtifact: { file: '/content/artifacts/artifact-id/standard-artifact.png' },
      },
    })

    buildArtifactAssetJobsMock.mockReturnValue([
      { id: 'artifact-id:standard_artifact', type: 'standard_artifact' },
      { id: 'artifact-id:hero_image', type: 'hero_image' },
      { id: 'artifact-id:portrait', type: 'portrait' },
    ])

    writeManifestMock.mockResolvedValue('/tmp/generation-manifest.json')

    const { manifest } = await generateArtifactImages({
      artifactPath: '/tmp/artifact.yaml',
      outputRoot: '/tmp',
      styleReferencePaths: [],
      artifactReferencePaths: [],
      defaultModel: 'flux-2-pro',
      heroModel: 'flux-2-pro',
      dryRun: true,
      overwrite: false,
      baseSeed: 4242,
      pollIntervalMs: 1000,
      maxPollAttempts: 120,
    })

    expect(manifest.assets).toHaveLength(3)
    expect(manifest.assets.map((asset) => asset.type)).toEqual([
      'standard_artifact',
      'hero_image',
      'portrait',
    ])
  })
})
