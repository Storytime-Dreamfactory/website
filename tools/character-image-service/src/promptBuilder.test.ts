import { describe, expect, it } from 'vitest'
import { buildCharacterAssetJobs } from './promptBuilder.ts'
import type { Character } from '../../../src/content/types.ts'

const sampleCharacter: Character = {
  id: 'testfigur',
  name: 'Testfigur',
  type: 'character',
  slug: 'testfigur',
  shortDescription: 'Eine kleine freundliche Testfigur.',
  basis: {
    species: 'Waschbaer',
    ageHint: 'kindlich',
    roleArchetype: 'helper',
  },
  appearance: {
    bodyShape: 'klein und rundlich',
    colors: ['grau', 'creme', 'rot'],
    hairOrFur: {
      color: 'grau',
      texture: 'weich',
      length: 'kurz',
    },
    eyes: {
      color: 'braun',
      expression: 'freundlich',
    },
    distinctiveFeatures: ['roter Schal', 'runde Ohren', 'kleine Pfoten'],
    clothingStyle: 'warmer Abenteuerlook',
  },
  personality: {
    coreTraits: ['hilfsbereit', 'mutig', 'warmherzig'],
    temperament: 'lebhaft',
    socialStyle: 'offen',
    strengths: ['troestet andere', 'hoert gut zu'],
    weaknesses: ['zweifelt an sich', 'zoegert kurz'],
    quirks: ['ordnet kleine Steine'],
  },
  storyPsychology: {
    visibleGoal: 'anderen helfen',
    deeperNeed: 'gebraucht werden',
    fear: 'dunkle Gewitterwolken',
    insecurity: 'Ich bin vielleicht zu klein.',
    stressResponse: 'hesitate_then_try',
    growthDirection: 'macht den ersten Schritt',
  },
  learningFunction: {
    teachingRoles: ['model'],
    suitableLearningGoals: ['courage'],
    explanationStyle: 'playful',
  },
  images: {
    standardFigure: {},
    heroImage: {},
    portrait: {},
    profileImage: {},
    additionalImages: [
      {
        type: 'emotion_happy',
        file: '/content/characters/testfigur/emotion-happy.png',
        description: 'Freudige Pose von Testfigur.',
      },
    ],
  },
  tags: ['warm'],
  metadata: {
    active: true,
    createdAt: '2026-03-09',
    updatedAt: '2026-03-09',
    version: 1,
  },
}

describe('buildCharacterAssetJobs', () => {
  it('nutzt fuer die standard figur image-edit sobald Stil-Referenzen vorhanden sind', () => {
    const jobs = buildCharacterAssetJobs({
      character: sampleCharacter,
      outputRoot: '/tmp/storytime',
      defaultModel: 'flux-2-klein-4b',
      heroModel: 'flux-2-klein-4b',
      baseSeed: 4242,
      styleReferencePaths: ['/tmp/storytime-style.png'],
      characterReferencePaths: [],
    })

    expect(jobs.find((job) => job.type === 'standard-figur')?.mode).toBe('image-edit')
  })

  it('reicht feste character referenzen auch an hero-image und portrait weiter', () => {
    const jobs = buildCharacterAssetJobs({
      character: sampleCharacter,
      outputRoot: '/tmp/storytime',
      defaultModel: 'flux-2-klein-4b',
      heroModel: 'flux-2-klein-4b',
      baseSeed: 4242,
      styleReferencePaths: ['/tmp/storytime-style.png'],
      characterReferencePaths: ['/tmp/merlin.png', '/tmp/agatha.png'],
    })

    expect(jobs.find((job) => job.type === 'hero-image')?.mode).toBe('image-edit')
    expect(jobs.find((job) => job.type === 'portrait')?.mode).toBe('image-edit')
  })

  it('bleibt ohne Referenzen bei text-to-image fuer die standard figur', () => {
    const jobs = buildCharacterAssetJobs({
      character: sampleCharacter,
      outputRoot: '/tmp/storytime',
      defaultModel: 'flux-2-klein-4b',
      heroModel: 'flux-2-klein-4b',
      baseSeed: 4242,
      styleReferencePaths: [],
      characterReferencePaths: [],
    })

    expect(jobs.find((job) => job.type === 'standard-figur')?.mode).toBe('text-to-image')
  })

  it('erzwingt fuer standard-figur einen weissen Hintergrund im Prompt', () => {
    const jobs = buildCharacterAssetJobs({
      character: sampleCharacter,
      outputRoot: '/tmp/storytime',
      defaultModel: 'flux-2-klein-4b',
      heroModel: 'flux-2-klein-4b',
      baseSeed: 4242,
      styleReferencePaths: ['/tmp/storytime-style.png'],
      characterReferencePaths: ['/tmp/nola.png', '/tmp/nova.png', '/tmp/yoko.png'],
    })

    const prompt = jobs.find((job) => job.type === 'standard-figur')?.prompt ?? ''
    expect(prompt).toContain('solid pure white background')
    expect(prompt).toContain('Do not show a scene, props, horizon, colored backdrop, gradient, or transparent background')
  })

  it('erzwingt fuer emotionsbilder weissen Hintergrund und klar unterschiedliche Pose', () => {
    const jobs = buildCharacterAssetJobs({
      character: sampleCharacter,
      outputRoot: '/tmp/storytime',
      defaultModel: 'flux-2-klein-4b',
      heroModel: 'flux-2-klein-4b',
      baseSeed: 4242,
      styleReferencePaths: ['/tmp/storytime-style.png'],
      characterReferencePaths: ['/tmp/nola.png', '/tmp/nova.png', '/tmp/yoko.png'],
    })

    const prompt = jobs.find((job) => job.type === 'emotion_happy')?.prompt ?? ''
    expect(prompt).toContain('solid pure white background')
    expect(prompt).toContain('must look clearly different from the other emotion assets')
    expect(prompt).toContain('wide smile')
  })
})
