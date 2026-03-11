export type CharacterBasis = {
  ageHint?: string
  species: string
  genderExpression?: string
  roleArchetype?: string
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

export type Place = {
  id: string
  name: string
  type: 'place'
  slug: string
  description: string
}

export type LearningGoal = {
  id: string
  name: string
  type: 'learning-goals'
  slug: string
  topic: string
  description: string
  ageRange: string[]
  exampleQuestions: string[]
  practiceIdeas: string[]
  domainTags: string[]
}

export type Artifact = {
  id: string
  name: string
  type: 'artifact'
  slug: string
  artifactType: string
  description: string
  contentFolder: string
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
