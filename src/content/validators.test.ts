import { describe, expect, it } from 'vitest'
import { validateArtifact, validateCharacter } from './validators'

const validCharacterYaml = {
  id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
  name: 'Nola',
  type: 'character',
  kurzbeschreibung: 'Eine neugierige Figur.',
  basis: {
    species: 'Flussotter',
    age_hint: 'kindlich',
    gender_expression: 'feminin',
    role_archetype: 'explorer',
  },
  voice: 'marin',
  voice_profile: {
    identity: 'Neugierige Entdeckerin',
    demeanor: 'ermutigend',
    tone: 'warm',
    enthusiasm_level: 'hoch',
    formality_level: 'locker',
    emotion_level: 'ausdrucksstark',
    filler_words: 'occasionally',
    pacing: 'lebendig',
  },
  erscheinung: {
    body_shape: 'klein und flink',
    colors: ['braun', 'beige'],
    hair_or_fur: {
      color: 'braun',
      texture: 'weich',
      length: 'kurz',
    },
    eyes: {
      color: 'dunkelbraun',
      expression: 'freundlich',
    },
    distinctive_features: ['Merkmal 1', 'Merkmal 2'],
    clothing_style: 'praktisch',
  },
  persoenlichkeit: {
    core_traits: ['neugierig', 'freundlich'],
    temperament: 'lebhaft',
    social_style: 'offen',
    strengths: ['Ideen'],
    weaknesses: ['ungeduldig'],
    quirks: ['summt'],
  },
  story_psychology: {
    visible_goal: 'helfen',
    deeper_need: 'Zugehoerigkeit',
    fear: 'zu versagen',
    insecurity: 'Ich bin zu wild.',
    stress_response: 'flight',
    growth_direction: 'bleibt ruhiger',
  },
  learning_function: {
    teaching_roles: ['model'],
    suitable_learning_goals: ['patience'],
    explanation_style: 'playful',
  },
  bilder: {
    standard_figur: {},
    hero_image: {},
    portrait: {},
    profilbild: {},
    weitere_bilder: [],
  },
  tags: ['warm'],
  metadata: {
    active: true,
    created_at: '2026-03-08',
    updated_at: '2026-03-08',
    version: 1,
  },
}

const validArtifactYaml = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  name: 'Zauberstab der Weisheit',
  type: 'artifact',
  artifact_type: 'wand',
  description: 'Ein alter Stab mit sanftem Leuchten.',
  appearance: {
    form: 'schlanker Holzstab mit gebogener Spitze',
    size: 'unterarmlang',
    materials: ['Eichenholz', 'Mondsilber'],
    colors: ['braun', 'silber'],
    condition: 'gut gepflegt',
    distinctive_features: ['spiralfoermige Maserung', 'feine Sternenrunen'],
  },
  function: {
    primary_purpose: 'fokussiert kleine Lichtzauber',
    secondary_purposes: ['zeigt Spuren im Mondlicht'],
    activation: 'reagiert auf ruhige Sprache',
    effects: ['die Spitze leuchtet sanft'],
    limitations: ['verliert Kraft bei Hektik'],
  },
  sensory_profile: {
    sound: 'leises Summen',
    scent: 'harzig',
    texture: 'glatt',
    aura: 'ruhig',
  },
  origin: {
    creator: 'unbekannte Waldwerkstatt',
    era: 'alt',
    cultural_context: 'achtsame Nachtwanderungen',
    inscriptions: ['Licht zeigt den sanften Weg.'],
  },
  images: {
    standard_artifact: {
      file: '/content/artifacts/a1b2c3d4-e5f6-7890-abcd-ef1234567890/standard-artifact.png',
      description: 'Freigestelltes Artifact',
    },
    hero_image: {
      file: '/content/artifacts/a1b2c3d4-e5f6-7890-abcd-ef1234567890/hero-image.jpg',
      description: 'Cinematische Szene',
    },
    portrait: {
      file: '/content/artifacts/a1b2c3d4-e5f6-7890-abcd-ef1234567890/portrait.png',
      description: 'Card-Ansicht',
    },
  },
  tags: ['magical', 'guiding'],
  metadata: {
    active: true,
    created_at: '2026-03-13',
    updated_at: '2026-03-13',
    version: 1,
  },
}

describe('validateCharacter', () => {
  it('accepts required voice and voice_profile fields', () => {
    const result = validateCharacter(validCharacterYaml, 'nola', 'character.yaml')
    expect(result.voice).toBe('marin')
    expect(result.voiceProfile.identity).toBe('Neugierige Entdeckerin')
  })

  it('rejects missing voice_profile', () => {
    const value = { ...validCharacterYaml }
    delete (value as { voice_profile?: unknown }).voice_profile
    expect(() => validateCharacter(value, 'nola', 'character.yaml')).toThrow(
      /voice_profile/,
    )
  })

  it('rejects invalid filler_words value', () => {
    const value = {
      ...validCharacterYaml,
      voice_profile: {
        ...validCharacterYaml.voice_profile,
        filler_words: 'sometimes',
      },
    }
    expect(() => validateCharacter(value, 'nola', 'character.yaml')).toThrow(
      /voice_profile\.filler_words/,
    )
  })
})

describe('validateArtifact', () => {
  it('accepts property-based artifact manifests', () => {
    const result = validateArtifact(validArtifactYaml, 'zauberstab-der-weisheit', 'artifact.yaml')
    expect(result.function.primaryPurpose).toBe('fokussiert kleine Lichtzauber')
    expect(result.origin?.inscriptions).toEqual(['Licht zeigt den sanften Weg.'])
    expect(result.images.portrait.file).toBe(
      '/content/artifacts/a1b2c3d4-e5f6-7890-abcd-ef1234567890/portrait.png',
    )
  })

  it('rejects artifact relationships in yaml', () => {
    const value = {
      ...validArtifactYaml,
      relationships: {
        characters: [{ id: '8eb40291-65ee-49b6-b826-d7c7e97404c0' }],
      },
    }
    expect(() => validateArtifact(value, 'zauberstab-der-weisheit', 'artifact.yaml')).toThrow(
      /relationships/,
    )
  })

  it('rejects artifacts without portrait image target', () => {
    const value = {
      ...validArtifactYaml,
      images: {
        ...validArtifactYaml.images,
      } as Record<string, unknown>,
    }
    delete (value.images as { portrait?: unknown }).portrait

    expect(() => validateArtifact(value, 'zauberstab-der-weisheit', 'artifact.yaml')).toThrow(
      /images\.portrait/,
    )
  })

  it('rejects artifacts without standard_artifact image target', () => {
    const value = {
      ...validArtifactYaml,
      images: {
        ...validArtifactYaml.images,
      } as Record<string, unknown>,
    }
    delete (value.images as { standard_artifact?: unknown }).standard_artifact

    expect(() => validateArtifact(value, 'zauberstab-der-weisheit', 'artifact.yaml')).toThrow(
      /images\.standard_artifact/,
    )
  })

  it('rejects artifacts without hero_image image target', () => {
    const value = {
      ...validArtifactYaml,
      images: {
        ...validArtifactYaml.images,
      } as Record<string, unknown>,
    }
    delete (value.images as { hero_image?: unknown }).hero_image

    expect(() => validateArtifact(value, 'zauberstab-der-weisheit', 'artifact.yaml')).toThrow(
      /images\.hero_image/,
    )
  })
})
