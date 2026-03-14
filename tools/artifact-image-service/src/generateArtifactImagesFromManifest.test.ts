import { describe, expect, it, vi } from 'vitest'

const readContentManifestMock = vi.hoisted(() => vi.fn())
const generateArtifactImagesMock = vi.hoisted(() => vi.fn())

vi.mock('./contentManifest.ts', () => ({
  readContentManifest: readContentManifestMock,
}))

vi.mock('./generateArtifactImages.ts', () => ({
  generateArtifactImages: generateArtifactImagesMock,
}))

import { generateArtifactImagesFromManifest } from './generateArtifactImagesFromManifest.ts'

describe('generateArtifactImagesFromManifest', () => {
  it('iteriert ueber alle Artifact-Eintraege aus dem Content-Manifest', async () => {
    readContentManifestMock.mockResolvedValue({
      characters: [],
      places: [],
      learningGoals: [],
      artifacts: [
        '/content/artifacts/a-id/eins.yaml',
        '/content/artifacts/b-id/zwei.yaml',
      ],
    })

    generateArtifactImagesMock.mockResolvedValue({
      manifestPath: '/tmp/generation-manifest.json',
    })

    const result = await generateArtifactImagesFromManifest({
      contentManifestPath: '/tmp/content-manifest.json',
      outputRoot: '/tmp/output',
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

    expect(generateArtifactImagesMock).toHaveBeenCalledTimes(2)
    expect(result.artifactCount).toBe(2)
    expect(result.artifacts.every((entry) => entry.ok)).toBe(true)
  })
})
