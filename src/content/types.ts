export type CharacterBasis = {
  ageHint?: string
  species: string
  genderExpression?: string
  roleArchetype?: string
}

export const CHARACTER_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const

export type CharacterVoice = (typeof CHARACTER_VOICES)[number]

export const VOICE_PROFILE_FILLER_WORD_OPTIONS = [
  'none',
  'occasionally',
  'often',
  'very_often',
] as const

export type VoiceProfileFillerWords = (typeof VOICE_PROFILE_FILLER_WORD_OPTIONS)[number]

export type CharacterVoiceProfile = {
  identity: string
  demeanor: string
  tone: string
  enthusiasmLevel: string
  formalityLevel: string
  emotionLevel: string
  fillerWords: VoiceProfileFillerWords
  pacing: string
}

export type CharacterHairOrFur = {
  color?: string
  texture?: string
  length?: string
}

export type CharacterEyes = {
  color: string
  expression: string
}

export type CharacterAppearance = {
  bodyShape: string
  colors: string[]
  hairOrFur: CharacterHairOrFur
  eyes: CharacterEyes
  distinctiveFeatures: string[]
  clothingStyle: string
}

export type CharacterPersonality = {
  coreTraits: string[]
  temperament: string
  socialStyle: string
  strengths: string[]
  weaknesses: string[]
  quirks: string[]
}

export type CharacterStoryPsychology = {
  visibleGoal: string
  deeperNeed: string
  fear: string
  insecurity: string
  stressResponse: string
  growthDirection: string
}

export type CharacterLearningFunction = {
  teachingRoles: string[]
  suitableLearningGoals: string[]
  explanationStyle: string
}

export type CharacterOrigin = {
  birthPlace: string
  upbringingPlaces: string[]
  culturalContext: string[]
  religionOrBelief?: string
  historicalContext: string[]
  notes?: string
}

export type CharacterRelationshipToCharacter = {
  characterId: string
  type: string
  description?: string
}

export type CharacterRelationshipToPlace = {
  placeId: string
  type: string
  description?: string
}

export type CharacterRelationships = {
  characters: CharacterRelationshipToCharacter[]
  places: CharacterRelationshipToPlace[]
}

export type CharacterImageTarget = {
  file?: string
  description?: string
}

export type CharacterAdditionalImageTarget = CharacterImageTarget & {
  type: string
}

export type CharacterImages = {
  standardFigure: CharacterImageTarget
  heroImage: CharacterImageTarget
  portrait: CharacterImageTarget
  profileImage: CharacterImageTarget
  additionalImages: CharacterAdditionalImageTarget[]
}

export type CharacterMetadata = {
  active: boolean
  createdAt: string
  updatedAt: string
  version: number
}

export type GameObjectType = 'character' | 'place' | 'learning-goals' | 'artifact'

export type Character = {
  id: string
  name: string
  type: 'character'
  slug: string
  shortDescription: string
  basis: CharacterBasis
  voice: CharacterVoice
  voiceProfile: CharacterVoiceProfile
  appearance: CharacterAppearance
  personality: CharacterPersonality
  storyPsychology: CharacterStoryPsychology
  learningFunction: CharacterLearningFunction
  origin?: CharacterOrigin
  relationships?: CharacterRelationships
  images: CharacterImages
  tags: string[]
  metadata: CharacterMetadata
}

export type PlaceMapPosition = {
  x: number
  y: number
}

export type Place = {
  id: string
  name: string
  type: 'place'
  slug: string
  description: string
  mapPosition?: PlaceMapPosition
}

export type LearningGoalSession = {
  durationMinutes: number
  format: string
  sessionGoal: string
  endState: string
}

export type LearningGoalCurriculum = {
  domain: string
  tags: string[]
  priorKnowledge: string[]
}

export type LearningGoalTeachingContent = {
  coreIdeas: string[]
  keyVocabulary: string[]
  examples: string[]
  misconceptions: string[]
}

export type LearningGoalDidactics = {
  pedagogy: string[]
  characterRole: string
  teachingSteps: string[]
  interactionRules: string[]
}

export type LearningGoalObjective = {
  id: string
  canDo: string
  evidence?: string[]
  originalEn?: string
}

export type CurriculumSource = {
  framework: string
  keyStage: number
  yearGroup: number
  subjectEn: string
  topicEn: string
  documentRef: string
}

export type LearningGoalQuizAnswerExpectations = {
  strongSignals: string[]
  acceptableSignals: string[]
  weakSignals: string[]
  misconceptionSignals: string[]
}

export type LearningGoalQuizFeedbackStrategy = {
  encouragementStyle: string
  hintSequence: string[]
  followUpPrompts: string[]
}

export type LearningGoalQuiz = {
  goal: string
  assessmentTargets: string[]
  allowedQuestionTypes: string[]
  exampleQuestions: string[]
  exampleTasks: string[]
  answerExpectations: LearningGoalQuizAnswerExpectations
  feedbackStrategy: LearningGoalQuizFeedbackStrategy
}

export type LearningGoal = {
  id: string
  name: string
  type: 'learning-goals'
  slug: string
  subject: string
  topicGroup: string
  topic: string
  subtopic: string
  description: string
  ageRange: string[]
  exampleQuestions?: string[]
  practiceIdeas?: string[]
  domainTags: string[]
  curriculumSource?: CurriculumSource
  session?: LearningGoalSession
  curriculum?: LearningGoalCurriculum
  teachingContent?: LearningGoalTeachingContent
  didactics?: LearningGoalDidactics
  learningObjectives: LearningGoalObjective[]
  quiz?: LearningGoalQuiz
}

export type ArtifactAppearance = {
  form: string
  size?: string
  materials: string[]
  colors: string[]
  condition: string
  distinctiveFeatures: string[]
}

export type ArtifactFunction = {
  primaryPurpose: string
  secondaryPurposes: string[]
  activation?: string
  effects: string[]
  limitations: string[]
}

export type ArtifactSensoryProfile = {
  sound?: string
  scent?: string
  texture?: string
  aura?: string
}

export type ArtifactOrigin = {
  creator?: string
  era?: string
  culturalContext?: string
  inscriptions: string[]
}

export type ArtifactImageTarget = {
  file: string
  description?: string
}

export type ArtifactImages = {
  standardArtifact: ArtifactImageTarget
  heroImage: ArtifactImageTarget
  portrait: ArtifactImageTarget
}

export type ArtifactMetadata = {
  active: boolean
  createdAt: string
  updatedAt: string
  version: number
}

export type Artifact = {
  id: string
  name: string
  type: 'artifact'
  slug: string
  artifactType: string
  description: string
  appearance: ArtifactAppearance
  function: ArtifactFunction
  sensoryProfile?: ArtifactSensoryProfile
  origin?: ArtifactOrigin
  images: ArtifactImages
  tags: string[]
  metadata: ArtifactMetadata
}

export type GameObject = Character | Place | LearningGoal | Artifact

export type GameObjectRef = {
  type: GameObjectType
  id: string
}

export type StoryRequest = {
  childName: string
  characters: string[]
  place: string
  learningGoal: string
}

export type StoryContent = {
  characters: Character[]
  places: Place[]
  learningGoals: LearningGoal[]
  artifacts: Artifact[]
  source: 'runtime' | 'fallback'
  warnings: string[]
}

export type ContentManifest = {
  characters: string[]
  places: string[]
  learningGoals: string[]
  artifacts: string[]
}
