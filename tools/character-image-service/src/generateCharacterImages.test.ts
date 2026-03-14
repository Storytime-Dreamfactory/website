import { describe, expect, it, vi } from 'vitest'

const buildCharacterAssetJobsMock = vi.hoisted(() => vi.fn())
const loadCharacterFromYamlMock = vi.hoisted(() => vi.fn())
const writeDownloadedImageMock = vi.hoisted(() => vi.fn())
const writeManifestMock = vi.hoisted(() => vi.fn())
const generateImageWithModelMock = vi.hoisted(() => vi.fn())

vi.mock('./promptBuilder.ts', () => ({
  buildCharacterAssetJobs: buildCharacterAssetJobsMock,
}))

vi.mock('./loadCharacter.ts', () => ({
  loadCharacterFromYaml: loadCharacterFromYamlMock,
}))

vi.mock('./assetWriter.ts', () => ({
  writeDownloadedImage: writeDownloadedImageMock,
  writeManifest: writeManifestMock,
}))

vi.mock('../../../src/server/imageGenerationService.ts', () => ({
  generateImageWithModel: generateImageWithModelMock,
}))

import { generateCharacterImages } from './generateCharacterImages.ts'

const baseCharacter = {
  id: 'test-character',
  images: {
    standardFigure: {},
  },
}

const baseJob = {
  id: 'test-character:portrait',
  kind: 'portrait',
  type: 'portrait',
  label: 'Portrait',
  prompt: 'portrait prompt',
  width: 896,
  height: 1200,
  outputFormat: 'png',
  mode: 'image-edit',
  model: 'flux-2-pro',
  outputFilePath: '/tmp/portrait.png',
  publicFilePath: '/content/characters/test-character/portrait.png',
  fileName: 'portrait.png',
  description: 'Portrait',
  seed: 4242,
} as const

describe('generateCharacterImages', () => {
  it('wiederholt einen Asset-Run einmal bei temporaerem Fehler', async () => {
    loadCharacterFromYamlMock.mockResolvedValue(baseCharacter)
    buildCharacterAssetJobsMock.mockReturnValue([baseJob])
    writeDownloadedImageMock.mockResolvedValue('written')
    writeManifestMock.mockResolvedValue('/tmp/generation-manifest.json')
    generateImageWithModelMock
      .mockRejectedValueOnce(new Error('FLUX polling timed out after 120 attempts'))
      .mockResolvedValueOnce({
        requestId: 'req-1',
        imageUrl: 'https://example.com/portrait.png',
        outputFormat: 'png',
      })

    const { manifest } = await generateCharacterImages({
      characterPath: '/tmp/character.yaml',
      outputRoot: '/tmp',
      styleReferencePaths: [],
      characterReferencePaths: ['/tmp/ref.png'],
      defaultModel: 'flux-2-pro',
      heroModel: 'flux-2-pro',
      dryRun: false,
      overwrite: true,
      baseSeed: 4242,
      pollIntervalMs: 1000,
      maxPollAttempts: 120,
    })

    expect(generateImageWithModelMock).toHaveBeenCalledTimes(2)
    expect(manifest.assets).toHaveLength(1)
    expect(manifest.assets[0]?.status).toBe('generated')
  })

  it('bricht den Gesamtjob nicht ab und markiert fehlgeschlagene Assets', async () => {
    const secondJob = {
      ...baseJob,
      id: 'test-character:profilbild',
      type: 'profilbild',
      label: 'Profilbild',
      outputFilePath: '/tmp/profilbild.png',
      publicFilePath: '/content/characters/test-character/profilbild.png',
      fileName: 'profilbild.png',
      width: 512,
      height: 512,
    }
    loadCharacterFromYamlMock.mockResolvedValue(baseCharacter)
    buildCharacterAssetJobsMock.mockReturnValue([baseJob, secondJob])
    writeDownloadedImageMock.mockResolvedValue('written')
    writeManifestMock.mockResolvedValue('/tmp/generation-manifest.json')
    generateImageWithModelMock
      .mockRejectedValueOnce(new Error('still failing'))
      .mockRejectedValueOnce(new Error('still failing'))
      .mockResolvedValueOnce({
        requestId: 'req-2',
        imageUrl: 'https://example.com/profilbild.png',
        outputFormat: 'png',
      })

    const { manifest } = await generateCharacterImages({
      characterPath: '/tmp/character.yaml',
      outputRoot: '/tmp',
      styleReferencePaths: [],
      characterReferencePaths: ['/tmp/ref.png'],
      defaultModel: 'flux-2-pro',
      heroModel: 'flux-2-pro',
      dryRun: false,
      overwrite: true,
      baseSeed: 4242,
      pollIntervalMs: 1000,
      maxPollAttempts: 120,
    })

    const statuses = manifest.assets.map((asset) => asset.status)
    expect(statuses).toContain('failed')
    expect(statuses).toContain('generated')
  })
})
