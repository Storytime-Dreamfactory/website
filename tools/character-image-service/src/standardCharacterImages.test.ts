import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { normalizeCharacterYamlWithStandardImages } from './standardCharacterImages.ts'

describe('normalizeCharacterYamlWithStandardImages', () => {
  it('ergaenzt Standard-Assets und Emotionsbilder', () => {
    const yamlText = `
id: testfigur
name: Testfigur
kurzbeschreibung: Eine freundliche Testfigur.
basis:
  species: Waschbaer
erscheinung:
  body_shape: klein
  colors:
    - blau
  eyes:
    color: braun
    expression: freundlich
  distinctive_features:
    - roter Schal
  clothing_style: warm
persoenlichkeit:
  core_traits:
    - mutig
  temperament: lebhaft
  social_style: offen
  strengths:
    - troestet andere
  weaknesses:
    - wird schnell nervoes
story_psychology:
  visible_goal: Freunde finden
  deeper_need: Zugehoerigkeit
  fear: dunkle Hohlen
  insecurity: Ich bin vielleicht zu klein.
  stress_response: hesitate_then_try
  growth_direction: lernt, sich mehr zuzutrauen
learning_function:
  teaching_roles:
    - model
  suitable_learning_goals:
    - courage
  explanation_style: playful
bilder:
  standard_figur: {}
  hero_image: {}
  portrait: {}
  profilbild: {}
  weitere_bilder:
    - typ: wave
      datei: /content/characters/testfigur/wave.png
      beschreibung: Winkt freundlich.
tags:
  - warm
metadata:
  active: true
  created_at: '2026-03-09'
  updated_at: '2026-03-09'
  version: 1
`

    const normalized = normalizeCharacterYamlWithStandardImages(yamlText, 'testfigur')
    const parsed = parse(normalized) as {
      bilder: {
        standard_figur: { datei: string }
        hero_image: { datei: string }
        portrait: { datei: string }
        profilbild: { datei: string }
        weitere_bilder: Array<{ typ: string; datei: string; beschreibung: string }>
      }
    }

    expect(parsed.bilder.standard_figur.datei).toBe('/content/characters/testfigur/standard-figur.png')
    expect(parsed.bilder.hero_image.datei).toBe('/content/characters/testfigur/hero-image.jpg')
    expect(parsed.bilder.portrait.datei).toBe('/content/characters/testfigur/portrait.png')
    expect(parsed.bilder.profilbild.datei).toBe('/content/characters/testfigur/profilbild.png')
    expect(parsed.bilder.weitere_bilder.map((image) => image.typ)).toEqual(
      expect.arrayContaining(['wave', 'emotion_happy', 'emotion_sad']),
    )
    expect(parsed.bilder.weitere_bilder.map((image) => image.typ)).not.toEqual(
      expect.arrayContaining(['emotion_brave', 'emotion_shy']),
    )
    expect(
      parsed.bilder.weitere_bilder.find((image) => image.typ === 'emotion_happy')?.beschreibung,
    ).toContain('Testfigur')
  })
})
