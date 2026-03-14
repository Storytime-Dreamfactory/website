import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { evaluateCharacterImage } from './imageEvaluationService.ts'
import type { Character } from '../../../src/content/types.ts'

const sampleCharacter: Character = {
  id: 'meri',
  name: 'Meri',
  type: 'character',
  slug: 'meri',
  shortDescription: 'Ein kleiner freundlicher Waschbaer mit rotem Schal.',
  basis: {
    species: 'Waschbaer',
    ageHint: 'kindlich',
    roleArchetype: 'helper',
  },
  voice: 'alloy',
  voiceProfile: {
    identity: 'Freundlicher Waschbaer',
    demeanor: 'ruhig und nahbar',
    tone: 'ermutigend',
    enthusiasmLevel: 'mittel',
    formalityLevel: 'niedrig',
    emotionLevel: 'warm',
    fillerWords: 'occasionally',
    pacing: 'ausgewogen',
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
      color: 'dunkelbraun',
      expression: 'freundlich und wach',
    },
    distinctiveFeatures: ['roter Schal', 'runde Ohren', 'kleine Pfoten'],
    clothingStyle: 'warmer Abenteuerlook',
  },
  personality: {
    coreTraits: ['hilfsbereit', 'vorsichtig', 'warmherzig'],
    temperament: 'lebhaft',
    socialStyle: 'offen',
    strengths: ['troestet andere', 'hoert gut zu'],
    weaknesses: ['zweifelt an sich', 'zoegert zu lange'],
    quirks: ['ordnet kleine Steine'],
  },
  storyPsychology: {
    visibleGoal: 'Freunde mutig begleiten',
    deeperNeed: 'Sich sicher und gebraucht fuehlen',
    fear: 'verlassen zu werden',
    insecurity: 'Bin ich mutig genug?',
    stressResponse: 'hesitate_then_try',
    growthDirection: 'traut sich, den ersten Schritt zu machen',
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
    additionalImages: [],
  },
  tags: ['warm'],
  metadata: {
    active: true,
    createdAt: '2026-03-09',
    updatedAt: '2026-03-09',
    version: 1,
  },
}

describe('evaluateCharacterImage', () => {
  let tempDirectory = ''

  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true })
      tempDirectory = ''
    }
  })

  it('wertet ein Bild mit dem schnellen Vision-Modell aus', async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'storytime-eval-'))
    const imagePath = path.join(tempDirectory, 'emotion-happy.png')
    await writeFile(imagePath, Buffer.from('fake-png-binary'))

    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          pass: true,
          childFriendly: true,
          styleScore: 8.9,
          safetyScore: 9.6,
          identityScore: 8.4,
          anomaliesDetected: false,
          riskFlags: [],
          summary: 'Das Bild ist warm, kindgerecht und passt gut zum Character.',
          styleNotes: 'Gute Farbwelt und klare Lesbarkeit.',
          safetyNotes: 'Keine problematischen Inhalte.',
          identityNotes: 'Der rote Schal und die runden Formen passen.',
        }),
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await evaluateCharacterImage({
      imagePath,
      assetType: 'emotion_happy',
      character: sampleCharacter,
      styleGuideText: 'Warme Lichter, runde Formen, keine Horrorwirkung.',
    })

    expect(result.pass).toBe(true)
    expect(result.childFriendly).toBe(true)
    expect(result.anomaliesDetected).toBe(false)
    expect(result.styleScore).toBe(8.9)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
        body: expect.stringContaining('"model":"gpt-4o-mini"'),
      }),
    )
  })

  it('akzeptiert auch JSON in Markdown-Fences', async () => {
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'storytime-eval-'))
    const imagePath = path.join(tempDirectory, 'portrait.png')
    await writeFile(imagePath, Buffer.from('fake-png-binary'))

    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        output_text: `\`\`\`json
{
  "pass": true,
  "childFriendly": true,
  "styleScore": 8.2,
  "safetyScore": 9.1,
  "identityScore": 8.3,
  "anomaliesDetected": false,
  "riskFlags": [],
  "summary": "Passt gut.",
  "styleNotes": "Stimmig.",
  "safetyNotes": "Sicher.",
  "identityNotes": "Konsistent."
}
\`\`\``,
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await evaluateCharacterImage({
      imagePath,
      assetType: 'portrait',
      character: sampleCharacter,
    })

    expect(result.pass).toBe(true)
    expect(result.summary).toBe('Passt gut.')
  })
})
