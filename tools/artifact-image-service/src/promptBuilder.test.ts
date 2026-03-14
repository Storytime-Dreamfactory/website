import { describe, expect, it } from 'vitest'
import type { Artifact } from '../../../src/content/types.ts'
import { buildArtifactAssetJobs } from './promptBuilder.ts'

const sampleArtifact: Artifact = {
  id: '2cd6d591-4037-432c-b564-f1097adbfb1a',
  name: 'Goldener Wandelstein',
  type: 'artifact',
  slug: 'goldener-wandelstein',
  artifactType: 'transformation-stone',
  description: 'Ein goldener Stein fuer groessenmagische Lernabenteuer.',
  appearance: {
    form: 'rundlicher Stein',
    size: 'handtellergross',
    materials: ['goldhaltiger Bergkristall'],
    colors: ['gold', 'honiggelb'],
    condition: 'makellos',
    distinctiveFeatures: ['funkelnde Adern'],
  },
  function: {
    primaryPurpose: 'verwandelt in Riese oder Zwerg',
    secondaryPurposes: ['Perspektivwechsel'],
    activation: 'Wunschwort sprechen',
    effects: ['waechst oder schrumpft'],
    limitations: ['nur kurze Zeit'],
  },
  sensoryProfile: {
    sound: 'leises Klingen',
    texture: 'glatt und warm',
  },
  origin: {
    creator: 'Aurelia',
    era: 'alte Sternenzeit',
    inscriptions: ['Gross oder klein, bleib immer du.'],
  },
  images: {
    standardArtifact: {
      file: '/content/artifacts/2cd6d591-4037-432c-b564-f1097adbfb1a/standard-artifact.png',
    },
    heroImage: {
      file: '/content/artifacts/2cd6d591-4037-432c-b564-f1097adbfb1a/hero-image.jpg',
    },
    portrait: {
      file: '/content/artifacts/2cd6d591-4037-432c-b564-f1097adbfb1a/portrait.png',
    },
  },
  tags: ['magical'],
  metadata: {
    active: true,
    createdAt: '2026-03-13',
    updatedAt: '2026-03-13',
    version: 1,
  },
}

describe('buildArtifactAssetJobs', () => {
  it('plant exakt drei Pflichtassets mit den korrekten Typen', () => {
    const jobs = buildArtifactAssetJobs({
      artifact: sampleArtifact,
      outputRoot: '/tmp/storytime',
      defaultModel: 'flux-2-pro',
      heroModel: 'flux-2-pro',
      baseSeed: 4242,
    })

    expect(jobs).toHaveLength(3)
    expect(jobs.map((job) => job.type)).toEqual(['standard_artifact', 'hero_image', 'portrait'])
  })

  it('verwendet die YAML-Bildpfade als publicFilePath', () => {
    const jobs = buildArtifactAssetJobs({
      artifact: sampleArtifact,
      outputRoot: '/tmp/storytime',
      defaultModel: 'flux-2-pro',
      heroModel: 'flux-2-pro',
      baseSeed: 4242,
    })

    expect(jobs.find((job) => job.type === 'standard_artifact')?.publicFilePath).toBe(
      sampleArtifact.images.standardArtifact.file,
    )
    expect(jobs.find((job) => job.type === 'hero_image')?.publicFilePath).toBe(
      sampleArtifact.images.heroImage.file,
    )
    expect(jobs.find((job) => job.type === 'portrait')?.publicFilePath).toBe(
      sampleArtifact.images.portrait.file,
    )
  })
})
