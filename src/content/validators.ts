import type { Character, LearningGoal, Place } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asString = (value: unknown, field: string, filePath: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  return value.trim()
}

const asOptionalString = (value: unknown, field: string, filePath: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  return value.trim().length > 0 ? value.trim() : undefined
}

const asStringList = (value: unknown, field: string, filePath: string): string[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  const list = value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`Invalid "${field}" entry in ${filePath}`)
    }
    return entry.trim()
  })

  return list
}

const asOptionalStringList = (value: unknown, field: string, filePath: string): string[] => {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  return value.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`Invalid "${field}" entry in ${filePath}`)
    }

    return entry.trim()
  })
}

const asOptionalRecordList = (
  value: unknown,
  field: string,
  filePath: string,
): Record<string, unknown>[] => {
  if (value === undefined || value === null) {
    return []
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  return value.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid "${field}" entry in ${filePath}`)
    }

    return entry
  })
}

const asBoolean = (value: unknown, field: string, filePath: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  return value
}

const asNumber = (value: unknown, field: string, filePath: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || Number.isNaN(value) || value < 1) {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  return value
}

const asRecord = (value: unknown, field: string, filePath: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  return value
}

const asOptionalRecord = (
  value: unknown,
  field: string,
  filePath: string,
): Record<string, unknown> | undefined => {
  if (value === undefined || value === null) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  return value
}

export const validateCharacter = (
  value: unknown,
  id: string,
  filePath: string,
): Character => {
  if (!isRecord(value)) {
    throw new Error(`Invalid character shape in ${filePath}`)
  }

  const basis = asRecord(value.basis, 'basis', filePath)
  const appearance = asRecord(value.erscheinung, 'erscheinung', filePath)
  const hairOrFur = asRecord(appearance.hair_or_fur, 'erscheinung.hair_or_fur', filePath)
  const eyes = asRecord(appearance.eyes, 'erscheinung.eyes', filePath)
  const personality = asRecord(value.persoenlichkeit, 'persoenlichkeit', filePath)
  const storyPsychology = asRecord(value.story_psychology, 'story_psychology', filePath)
  const learningFunction = asRecord(value.learning_function, 'learning_function', filePath)
  const origin = asOptionalRecord(value.herkunft, 'herkunft', filePath)
  const relationships = asOptionalRecord(value.relationships, 'relationships', filePath)
  const images = asRecord(value.bilder, 'bilder', filePath)
  const standardFigure = asRecord(images.standard_figur, 'bilder.standard_figur', filePath)
  const heroImage = asRecord(images.hero_image, 'bilder.hero_image', filePath)
  const portrait = asRecord(images.portrait, 'bilder.portrait', filePath)
  const profileImage = asRecord(images.profilbild, 'bilder.profilbild', filePath)
  const metadata = asRecord(value.metadata, 'metadata', filePath)
  const yamlId = asOptionalString(value.id, 'id', filePath)

  if (yamlId && yamlId !== id) {
    throw new Error(`Character id mismatch in ${filePath}: expected "${id}" but found "${yamlId}"`)
  }

  return {
    id: yamlId ?? id,
    name: asString(value.name, 'name', filePath),
    shortDescription: asString(value.kurzbeschreibung, 'kurzbeschreibung', filePath),
    basis: {
      ageHint: asOptionalString(basis.age_hint, 'basis.age_hint', filePath),
      species: asString(basis.species, 'basis.species', filePath),
      genderExpression: asOptionalString(
        basis.gender_expression,
        'basis.gender_expression',
        filePath,
      ),
      roleArchetype: asOptionalString(basis.role_archetype, 'basis.role_archetype', filePath),
    },
    appearance: {
      bodyShape: asString(appearance.body_shape, 'erscheinung.body_shape', filePath),
      colors: asStringList(appearance.colors, 'erscheinung.colors', filePath),
      hairOrFur: {
        color: asOptionalString(hairOrFur.color, 'erscheinung.hair_or_fur.color', filePath),
        texture: asOptionalString(
          hairOrFur.texture,
          'erscheinung.hair_or_fur.texture',
          filePath,
        ),
        length: asOptionalString(hairOrFur.length, 'erscheinung.hair_or_fur.length', filePath),
      },
      eyes: {
        color: asString(eyes.color, 'erscheinung.eyes.color', filePath),
        expression: asString(eyes.expression, 'erscheinung.eyes.expression', filePath),
      },
      distinctiveFeatures: asStringList(
        appearance.distinctive_features,
        'erscheinung.distinctive_features',
        filePath,
      ),
      clothingStyle: asString(
        appearance.clothing_style,
        'erscheinung.clothing_style',
        filePath,
      ),
    },
    personality: {
      coreTraits: asStringList(personality.core_traits, 'persoenlichkeit.core_traits', filePath),
      temperament: asString(personality.temperament, 'persoenlichkeit.temperament', filePath),
      socialStyle: asString(personality.social_style, 'persoenlichkeit.social_style', filePath),
      strengths: asStringList(personality.strengths, 'persoenlichkeit.strengths', filePath),
      weaknesses: asStringList(personality.weaknesses, 'persoenlichkeit.weaknesses', filePath),
      quirks: asOptionalStringList(personality.quirks, 'persoenlichkeit.quirks', filePath),
    },
    storyPsychology: {
      visibleGoal: asString(storyPsychology.visible_goal, 'story_psychology.visible_goal', filePath),
      deeperNeed: asString(storyPsychology.deeper_need, 'story_psychology.deeper_need', filePath),
      fear: asString(storyPsychology.fear, 'story_psychology.fear', filePath),
      insecurity: asString(storyPsychology.insecurity, 'story_psychology.insecurity', filePath),
      stressResponse: asString(
        storyPsychology.stress_response,
        'story_psychology.stress_response',
        filePath,
      ),
      growthDirection: asString(
        storyPsychology.growth_direction,
        'story_psychology.growth_direction',
        filePath,
      ),
    },
    learningFunction: {
      teachingRoles: asStringList(
        learningFunction.teaching_roles,
        'learning_function.teaching_roles',
        filePath,
      ),
      suitableLearningGoals: asStringList(
        learningFunction.suitable_learning_goals,
        'learning_function.suitable_learning_goals',
        filePath,
      ),
      explanationStyle: asString(
        learningFunction.explanation_style,
        'learning_function.explanation_style',
        filePath,
      ),
    },
    origin: origin
      ? {
          birthPlace: asString(origin.geburtsort, 'herkunft.geburtsort', filePath),
          upbringingPlaces: asStringList(
            origin.aufgewachsen_in,
            'herkunft.aufgewachsen_in',
            filePath,
          ),
          culturalContext: asStringList(
            origin.kulturelle_praegung,
            'herkunft.kulturelle_praegung',
            filePath,
          ),
          religionOrBelief: asOptionalString(
            origin.religion_oder_weltbild,
            'herkunft.religion_oder_weltbild',
            filePath,
          ),
          historicalContext: asStringList(
            origin.historische_praegung,
            'herkunft.historische_praegung',
            filePath,
          ),
          notes: asOptionalString(origin.notizen, 'herkunft.notizen', filePath),
        }
      : undefined,
    relationships: relationships
      ? {
          characters: asOptionalRecordList(
            relationships.characters,
            'relationships.characters',
            filePath,
          ).map((relationship) => ({
            characterId: asString(
              relationship.character_id,
              'relationships.characters[].character_id',
              filePath,
            ),
            type: asString(relationship.typ, 'relationships.characters[].typ', filePath),
            description: asOptionalString(
              relationship.beschreibung,
              'relationships.characters[].beschreibung',
              filePath,
            ),
          })),
          places: asOptionalRecordList(relationships.places, 'relationships.places', filePath).map(
            (relationship) => ({
              placeId: asString(relationship.place_id, 'relationships.places[].place_id', filePath),
              type: asString(relationship.typ, 'relationships.places[].typ', filePath),
              description: asOptionalString(
                relationship.beschreibung,
                'relationships.places[].beschreibung',
                filePath,
              ),
            }),
          ),
        }
      : undefined,
    images: {
      standardFigure: {
        file: asOptionalString(standardFigure.datei, 'bilder.standard_figur.datei', filePath),
        description: asOptionalString(
          standardFigure.beschreibung,
          'bilder.standard_figur.beschreibung',
          filePath,
        ),
      },
      heroImage: {
        file: asOptionalString(heroImage.datei, 'bilder.hero_image.datei', filePath),
        description: asOptionalString(
          heroImage.beschreibung,
          'bilder.hero_image.beschreibung',
          filePath,
        ),
      },
      portrait: {
        file: asOptionalString(portrait.datei, 'bilder.portrait.datei', filePath),
        description: asOptionalString(portrait.beschreibung, 'bilder.portrait.beschreibung', filePath),
      },
      profileImage: {
        file: asOptionalString(profileImage.datei, 'bilder.profilbild.datei', filePath),
        description: asOptionalString(
          profileImage.beschreibung,
          'bilder.profilbild.beschreibung',
          filePath,
        ),
      },
      additionalImages: asOptionalRecordList(images.weitere_bilder, 'bilder.weitere_bilder', filePath).map(
        (additionalImage) => ({
          type: asString(additionalImage.typ, 'bilder.weitere_bilder[].typ', filePath),
          file: asOptionalString(additionalImage.datei, 'bilder.weitere_bilder[].datei', filePath),
          description: asOptionalString(
            additionalImage.beschreibung,
            'bilder.weitere_bilder[].beschreibung',
            filePath,
          ),
        }),
      ),
    },
    tags: asStringList(value.tags, 'tags', filePath),
    metadata: {
      active: asBoolean(metadata.active, 'metadata.active', filePath),
      createdAt: asString(metadata.created_at, 'metadata.created_at', filePath),
      updatedAt: asString(metadata.updated_at, 'metadata.updated_at', filePath),
      version: asNumber(metadata.version, 'metadata.version', filePath),
    },
  }
}

export const validatePlace = (value: unknown, id: string, filePath: string): Place => {
  if (!isRecord(value)) {
    throw new Error(`Invalid place shape in ${filePath}`)
  }

  return {
    id,
    name: asString(value.name, 'name', filePath),
    description: asString(value.description, 'description', filePath),
  }
}

export const validateLearningGoal = (
  value: unknown,
  id: string,
  filePath: string,
): LearningGoal => {
  if (!isRecord(value)) {
    throw new Error(`Invalid learning goal shape in ${filePath}`)
  }

  return {
    id,
    name: asString(value.name, 'name', filePath),
    topic: asString(value.topic, 'topic', filePath),
    description: asString(value.description, 'description', filePath),
    ageRange: asOptionalStringList(value.age_range, 'age_range', filePath),
    exampleQuestions: asStringList(value.example_questions, 'example_questions', filePath),
    practiceIdeas: asOptionalStringList(value.practice_ideas, 'practice_ideas', filePath),
    domainTags: asOptionalStringList(value.domain_tags, 'domain_tags', filePath),
  }
}
