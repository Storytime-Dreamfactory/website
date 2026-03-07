import type { Character, Place, Skill } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const asString = (value: unknown, field: string, filePath: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid "${field}" in ${filePath}`)
  }

  return value.trim()
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

export const validateCharacter = (
  value: unknown,
  id: string,
  filePath: string,
): Character => {
  if (!isRecord(value)) {
    throw new Error(`Invalid character shape in ${filePath}`)
  }

  return {
    id,
    name: asString(value.name, 'name', filePath),
    description: asString(value.description, 'description', filePath),
    history: asStringList(value.history, 'history', filePath),
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

export const validateSkill = (value: unknown, id: string, filePath: string): Skill => {
  if (!isRecord(value)) {
    throw new Error(`Invalid skill shape in ${filePath}`)
  }

  return {
    id,
    name: asString(value.name, 'name', filePath),
    description: asString(value.description, 'description', filePath),
    quizExamples: asStringList(value.quiz_examples, 'quiz_examples', filePath),
  }
}
