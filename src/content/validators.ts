import {
  CHARACTER_VOICES,
  VOICE_PROFILE_FILLER_WORD_OPTIONS,
  type Artifact,
  type Character,
  type LearningGoal,
  type Place,
} from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

const asLiteral = <T extends string>(
  value: unknown,
  field: string,
  filePath: string,
  allowedValues: readonly T[],
): T => {
  const parsed = asString(value, field, filePath)
  if (!allowedValues.includes(parsed as T)) {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }
  return parsed as T
}

export const validateCharacter = (
  value: unknown,
  slug: string,
  filePath: string,
): Character => {
  if (!isRecord(value)) {
    throw new Error(`Invalid character shape in ${filePath}`)
  }

  const yamlId = asString(value.id, 'id', filePath)
  if (!UUID_RE.test(yamlId)) {
    throw new Error(`Invalid UUID id "${yamlId}" in ${filePath}`)
  }

  const basis = asRecord(value.basis, 'basis', filePath)
  const voiceProfile = asRecord(value.voice_profile, 'voice_profile', filePath)
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

  return {
    id: yamlId,
    name: asString(value.name, 'name', filePath),
    type: 'character',
    slug,
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
    voice: asLiteral(value.voice, 'voice', filePath, CHARACTER_VOICES),
    voiceProfile: {
      identity: asString(voiceProfile.identity, 'voice_profile.identity', filePath),
      demeanor: asString(voiceProfile.demeanor, 'voice_profile.demeanor', filePath),
      tone: asString(voiceProfile.tone, 'voice_profile.tone', filePath),
      enthusiasmLevel: asString(
        voiceProfile.enthusiasm_level,
        'voice_profile.enthusiasm_level',
        filePath,
      ),
      formalityLevel: asString(
        voiceProfile.formality_level,
        'voice_profile.formality_level',
        filePath,
      ),
      emotionLevel: asString(voiceProfile.emotion_level, 'voice_profile.emotion_level', filePath),
      fillerWords: asLiteral(
        voiceProfile.filler_words,
        'voice_profile.filler_words',
        filePath,
        VOICE_PROFILE_FILLER_WORD_OPTIONS,
      ),
      pacing: asString(voiceProfile.pacing, 'voice_profile.pacing', filePath),
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

export const validatePlace = (value: unknown, slug: string, filePath: string): Place => {
  if (!isRecord(value)) {
    throw new Error(`Invalid place shape in ${filePath}`)
  }

  const yamlId = asString(value.id, 'id', filePath)
  if (!UUID_RE.test(yamlId)) {
    throw new Error(`Invalid UUID id "${yamlId}" in ${filePath}`)
  }

  return {
    id: yamlId,
    name: asString(value.name, 'name', filePath),
    type: 'place',
    slug,
    description: asString(value.description, 'description', filePath),
  }
}

export const validateLearningGoal = (
  value: unknown,
  slug: string,
  filePath: string,
): LearningGoal => {
  if (!isRecord(value)) {
    throw new Error(`Invalid learning goal shape in ${filePath}`)
  }

  const yamlId = asString(value.id, 'id', filePath)
  if (!UUID_RE.test(yamlId)) {
    throw new Error(`Invalid UUID id "${yamlId}" in ${filePath}`)
  }

  const session = asOptionalRecord(value.session, 'session', filePath)
  const curriculumSourceRaw = asOptionalRecord(value.curriculum_source, 'curriculum_source', filePath)
  const curriculum = asOptionalRecord(value.curriculum, 'curriculum', filePath)
  const teachingContent = asOptionalRecord(value.teaching_content, 'teaching_content', filePath)
  const didactics = asOptionalRecord(value.didactics, 'didactics', filePath)
  const quiz = asOptionalRecord(value.quiz, 'quiz', filePath)
  const answerExpectations = quiz
    ? asOptionalRecord(quiz.answer_expectations, 'quiz.answer_expectations', filePath)
    : undefined
  const feedbackStrategy = quiz
    ? asOptionalRecord(quiz.feedback_strategy, 'quiz.feedback_strategy', filePath)
    : undefined
  const learningObjectives = asOptionalRecordList(
    value.learning_objectives,
    'learning_objectives',
    filePath,
  )
  const exampleQuestions =
    value.example_questions ?? quiz?.example_questions ?? value.exampleQuestions ?? undefined
  const practiceIdeas = value.practice_ideas ?? undefined
  const domainTags = value.domain_tags ?? curriculum?.tags ?? undefined

  return {
    id: yamlId,
    name: asString(value.name, 'name', filePath),
    type: 'learning-goals',
    slug,
    subject: asString(value.subject, 'subject', filePath),
    topicGroup: asString(value.topic_group, 'topic_group', filePath),
    topic: asString(value.topic, 'topic', filePath),
    subtopic: asOptionalString(value.subtopic, 'subtopic', filePath) ?? '',
    description: asString(value.description, 'description', filePath),
    ageRange: asOptionalStringList(value.age_range, 'age_range', filePath),
    exampleQuestions: asOptionalStringList(exampleQuestions, 'example_questions', filePath),
    practiceIdeas: asOptionalStringList(practiceIdeas, 'practice_ideas', filePath),
    domainTags: asOptionalStringList(domainTags, 'domain_tags', filePath),
    session: session
      ? {
          durationMinutes: asNumber(session.duration_minutes, 'session.duration_minutes', filePath),
          format: asString(session.format, 'session.format', filePath),
          sessionGoal: asString(session.session_goal, 'session.session_goal', filePath),
          endState: asString(session.end_state, 'session.end_state', filePath),
        }
      : undefined,
    curriculum: curriculum
      ? {
          domain: asString(curriculum.domain, 'curriculum.domain', filePath),
          tags: asOptionalStringList(curriculum.tags, 'curriculum.tags', filePath),
          priorKnowledge: asOptionalStringList(
            curriculum.prior_knowledge,
            'curriculum.prior_knowledge',
            filePath,
          ),
        }
      : undefined,
    teachingContent: teachingContent
      ? {
          coreIdeas: asOptionalStringList(
            teachingContent.core_ideas,
            'teaching_content.core_ideas',
            filePath,
          ),
          keyVocabulary: asOptionalStringList(
            teachingContent.key_vocabulary,
            'teaching_content.key_vocabulary',
            filePath,
          ),
          examples: asOptionalStringList(teachingContent.examples, 'teaching_content.examples', filePath),
          misconceptions: asOptionalStringList(
            teachingContent.misconceptions,
            'teaching_content.misconceptions',
            filePath,
          ),
        }
      : undefined,
    didactics: didactics
      ? {
          pedagogy: asOptionalStringList(didactics.pedagogy, 'didactics.pedagogy', filePath),
          characterRole: asString(didactics.character_role, 'didactics.character_role', filePath),
          teachingSteps: asOptionalStringList(
            didactics.teaching_steps,
            'didactics.teaching_steps',
            filePath,
          ),
          interactionRules: asOptionalStringList(
            didactics.interaction_rules,
            'didactics.interaction_rules',
            filePath,
          ),
        }
      : undefined,
    curriculumSource: curriculumSourceRaw
      ? {
          framework: asString(curriculumSourceRaw.framework, 'curriculum_source.framework', filePath),
          keyStage: asNumber(curriculumSourceRaw.key_stage, 'curriculum_source.key_stage', filePath),
          yearGroup: asNumber(curriculumSourceRaw.year_group, 'curriculum_source.year_group', filePath),
          subjectEn: asString(curriculumSourceRaw.subject_en, 'curriculum_source.subject_en', filePath),
          topicEn: asString(curriculumSourceRaw.topic_en, 'curriculum_source.topic_en', filePath),
          documentRef: asString(curriculumSourceRaw.document_ref, 'curriculum_source.document_ref', filePath),
        }
      : undefined,
    learningObjectives: learningObjectives.map((objective) => ({
      id: asString(objective.id, 'learning_objectives[].id', filePath),
      canDo: asString(objective.can_do, 'learning_objectives[].can_do', filePath),
      evidence: asOptionalStringList(objective.evidence, 'learning_objectives[].evidence', filePath),
      originalEn: asOptionalString(objective.original_en, 'learning_objectives[].original_en', filePath),
    })),
    quiz: quiz
      ? {
          goal: asString(quiz.goal, 'quiz.goal', filePath),
          assessmentTargets: asOptionalStringList(
            quiz.assessment_targets,
            'quiz.assessment_targets',
            filePath,
          ),
          allowedQuestionTypes: asOptionalStringList(
            quiz.allowed_question_types,
            'quiz.allowed_question_types',
            filePath,
          ),
          exampleQuestions: asStringList(
            quiz.example_questions,
            'quiz.example_questions',
            filePath,
          ),
          exampleTasks: asOptionalStringList(quiz.example_tasks, 'quiz.example_tasks', filePath),
          answerExpectations: {
            strongSignals: asOptionalStringList(
              answerExpectations?.strong_signals,
              'quiz.answer_expectations.strong_signals',
              filePath,
            ),
            acceptableSignals: asOptionalStringList(
              answerExpectations?.acceptable_signals,
              'quiz.answer_expectations.acceptable_signals',
              filePath,
            ),
            weakSignals: asOptionalStringList(
              answerExpectations?.weak_signals,
              'quiz.answer_expectations.weak_signals',
              filePath,
            ),
            misconceptionSignals: asOptionalStringList(
              answerExpectations?.misconception_signals,
              'quiz.answer_expectations.misconception_signals',
              filePath,
            ),
          },
          feedbackStrategy: {
            encouragementStyle: asString(
              feedbackStrategy?.encouragement_style,
              'quiz.feedback_strategy.encouragement_style',
              filePath,
            ),
            hintSequence: asOptionalStringList(
              feedbackStrategy?.hint_sequence,
              'quiz.feedback_strategy.hint_sequence',
              filePath,
            ),
            followUpPrompts: asOptionalStringList(
              feedbackStrategy?.follow_up_prompts,
              'quiz.feedback_strategy.follow_up_prompts',
              filePath,
            ),
          },
        }
      : undefined,
  }
}

export const validateArtifact = (
  value: unknown,
  slug: string,
  filePath: string,
): Artifact => {
  if (!isRecord(value)) {
    throw new Error(`Invalid artifact shape in ${filePath}`)
  }

  const yamlId = asString(value.id, 'id', filePath)
  if (!UUID_RE.test(yamlId)) {
    throw new Error(`Invalid UUID id "${yamlId}" in ${filePath}`)
  }

  if (value.relationships !== undefined) {
    throw new Error(`Artifacts must not define "relationships" in ${filePath}`)
  }

  if (value.content_folder !== undefined) {
    throw new Error(`Artifacts must not define "content_folder" in ${filePath}`)
  }

  const appearance = asRecord(value.appearance, 'appearance', filePath)
  const artifactFunction = asRecord(value.function, 'function', filePath)
  const sensoryProfile = asOptionalRecord(value.sensory_profile, 'sensory_profile', filePath)
  const origin = asOptionalRecord(value.origin, 'origin', filePath)
  const images = asRecord(value.images, 'images', filePath)
  const standardArtifact = asRecord(images.standard_artifact, 'images.standard_artifact', filePath)
  const heroImage = asRecord(images.hero_image, 'images.hero_image', filePath)
  const portrait = asRecord(images.portrait, 'images.portrait', filePath)
  const metadata = asRecord(value.metadata, 'metadata', filePath)

  return {
    id: yamlId,
    name: asString(value.name, 'name', filePath),
    type: 'artifact',
    slug,
    artifactType: asString(value.artifact_type, 'artifact_type', filePath),
    description: asString(value.description, 'description', filePath),
    appearance: {
      form: asString(appearance.form, 'appearance.form', filePath),
      size: asOptionalString(appearance.size, 'appearance.size', filePath),
      materials: asStringList(appearance.materials, 'appearance.materials', filePath),
      colors: asStringList(appearance.colors, 'appearance.colors', filePath),
      condition: asString(appearance.condition, 'appearance.condition', filePath),
      distinctiveFeatures: asStringList(
        appearance.distinctive_features,
        'appearance.distinctive_features',
        filePath,
      ),
    },
    function: {
      primaryPurpose: asString(artifactFunction.primary_purpose, 'function.primary_purpose', filePath),
      secondaryPurposes: asOptionalStringList(
        artifactFunction.secondary_purposes,
        'function.secondary_purposes',
        filePath,
      ),
      activation: asOptionalString(artifactFunction.activation, 'function.activation', filePath),
      effects: asStringList(artifactFunction.effects, 'function.effects', filePath),
      limitations: asOptionalStringList(artifactFunction.limitations, 'function.limitations', filePath),
    },
    sensoryProfile: sensoryProfile
      ? {
          sound: asOptionalString(sensoryProfile.sound, 'sensory_profile.sound', filePath),
          scent: asOptionalString(sensoryProfile.scent, 'sensory_profile.scent', filePath),
          texture: asOptionalString(sensoryProfile.texture, 'sensory_profile.texture', filePath),
          aura: asOptionalString(sensoryProfile.aura, 'sensory_profile.aura', filePath),
        }
      : undefined,
    origin: origin
      ? {
          creator: asOptionalString(origin.creator, 'origin.creator', filePath),
          era: asOptionalString(origin.era, 'origin.era', filePath),
          culturalContext: asOptionalString(
            origin.cultural_context,
            'origin.cultural_context',
            filePath,
          ),
          inscriptions: asOptionalStringList(origin.inscriptions, 'origin.inscriptions', filePath),
        }
      : undefined,
    images: {
      standardArtifact: {
        file: asString(standardArtifact.file, 'images.standard_artifact.file', filePath),
        description: asOptionalString(
          standardArtifact.description,
          'images.standard_artifact.description',
          filePath,
        ),
      },
      heroImage: {
        file: asString(heroImage.file, 'images.hero_image.file', filePath),
        description: asOptionalString(heroImage.description, 'images.hero_image.description', filePath),
      },
      portrait: {
        file: asString(portrait.file, 'images.portrait.file', filePath),
        description: asOptionalString(portrait.description, 'images.portrait.description', filePath),
      },
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
