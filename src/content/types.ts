export type Character = {
  id: string
  name: string
  description: string
  history: string[]
}

export type Place = {
  id: string
  name: string
  description: string
}

export type Skill = {
  id: string
  name: string
  description: string
  quizExamples: string[]
}

export type StoryRequest = {
  childName: string
  characters: string[]
  place: string
  skill: string
}

export type StoryContent = {
  characters: Character[]
  places: Place[]
  skills: Skill[]
  source: 'runtime' | 'fallback'
  warnings: string[]
}

export type ContentManifest = {
  characters: string[]
  places: string[]
  skills: string[]
}
