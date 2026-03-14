import { beforeEach, describe, expect, it, vi } from 'vitest'

const randomUuidMock = vi.hoisted(() => vi.fn())
const generateCharacterYamlMock = vi.hoisted(() => vi.fn())
const retryWithFeedbackMock = vi.hoisted(() => vi.fn())
const validateCharacterMock = vi.hoisted(() => vi.fn())
const readFileMock = vi.hoisted(() => vi.fn())

vi.mock('node:crypto', () => ({
  randomUUID: randomUuidMock,
}))

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
}))

vi.mock('./llmClient.ts', () => ({
  generateCharacterYaml: generateCharacterYamlMock,
  retryWithFeedback: retryWithFeedbackMock,
}))

vi.mock('../../../src/content/validators.ts', () => ({
  validateCharacter: validateCharacterMock,
}))

import { createCharacterDraft } from './createCharacterDraft.ts'

describe('createCharacterDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readFileMock.mockResolvedValue('SYSTEM PROMPT')
    retryWithFeedbackMock.mockResolvedValue('')
    validateCharacterMock.mockReturnValue(undefined)
  })

  it('nutzt eine neue UUID, wenn das YAML keine UUID-id enthaelt', async () => {
    generateCharacterYamlMock.mockResolvedValue(`
id: merlin-figur
name: Merlin
kurzbeschreibung: Freundlich.
basis:
  species: Zauberer
voice: alloy
voice_profile:
  identity: ruhig
  demeanor: freundlich
  tone: warm
  enthusiasm_level: mittel
  formality_level: locker
  emotion_level: ausgewogen
  filler_words: none
  pacing: ruhig
erscheinung:
  body_shape: mittel
  colors: [blau]
  hair_or_fur: { color: grau, texture: glatt, length: kurz }
  eyes: { color: braun, expression: freundlich }
  distinctive_features: [Hut]
  clothing_style: Mantel
persoenlichkeit:
  core_traits: [hilfsbereit]
  temperament: ruhig
  social_style: offen
  strengths: [Zuhoeren]
  weaknesses: [zweifelt]
story_psychology:
  visible_goal: helfen
  deeper_need: Zugehoerigkeit
  fear: allein sein
  insecurity: Bin ich gut genug?
  stress_response: reflect
  growth_direction: traut sich mehr
learning_function:
  teaching_roles: [guide]
  suitable_learning_goals: [mut]
  explanation_style: calm
bilder:
  standard_figur: {}
  hero_image: {}
  portrait: {}
  profilbild: {}
  weitere_bilder: []
tags: [warm]
metadata:
  active: true
  created_at: '2026-03-13'
  updated_at: '2026-03-13'
  version: 1
`)
    randomUuidMock.mockReturnValue('11111111-1111-1111-1111-111111111111')

    const draft = await createCharacterDraft('Bitte neuen Character bauen.')

    expect(draft.characterId).toBe('11111111-1111-1111-1111-111111111111')
    expect(draft.yamlText).toContain('id: 11111111-1111-1111-1111-111111111111')
    expect(randomUuidMock).toHaveBeenCalledTimes(1)
  })

  it('behaelt eine gueltige UUID aus dem Modell, wenn sie nicht belegt ist', async () => {
    generateCharacterYamlMock.mockResolvedValue(`
id: 22222222-2222-2222-2222-222222222222
name: Nova
kurzbeschreibung: Freundlich.
basis:
  species: Fuchs
voice: alloy
voice_profile:
  identity: ruhig
  demeanor: freundlich
  tone: warm
  enthusiasm_level: mittel
  formality_level: locker
  emotion_level: ausgewogen
  filler_words: none
  pacing: ruhig
erscheinung:
  body_shape: mittel
  colors: [orange]
  hair_or_fur: { color: orange, texture: weich, length: kurz }
  eyes: { color: braun, expression: freundlich }
  distinctive_features: [Schal]
  clothing_style: Jacke
persoenlichkeit:
  core_traits: [neugierig]
  temperament: lebhaft
  social_style: offen
  strengths: [Mut]
  weaknesses: [ungeduldig]
story_psychology:
  visible_goal: entdecken
  deeper_need: Anerkennung
  fear: Dunkelheit
  insecurity: Schaffe ich das?
  stress_response: hesitate_then_try
  growth_direction: bleibt dran
learning_function:
  teaching_roles: [model]
  suitable_learning_goals: [geduld]
  explanation_style: playful
bilder:
  standard_figur: {}
  hero_image: {}
  portrait: {}
  profilbild: {}
  weitere_bilder: []
tags: [abenteuer]
metadata:
  active: true
  created_at: '2026-03-13'
  updated_at: '2026-03-13'
  version: 1
`)

    const draft = await createCharacterDraft('Bitte Character bauen.', {
      characters: [],
      places: [],
    })

    expect(draft.characterId).toBe('22222222-2222-2222-2222-222222222222')
    expect(randomUuidMock).not.toHaveBeenCalled()
  })
})
