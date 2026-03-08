export type ActivityInteractionTarget = {
  type: string
  id: string
  name?: string
  interactionType?: string
  role?: string
}

type JsonObject = Record<string, unknown>

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const normalizeTargetType = (value: string): string => value.toLowerCase().replace(/\s+/g, '-')

const toObject = (value: unknown): JsonObject | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as JsonObject
}

const normalizeInteractionTarget = (value: unknown): ActivityInteractionTarget | null => {
  const raw = toObject(value)
  if (!raw) return null
  const type = normalizeTargetType(readText(raw.type))
  const id = readText(raw.id)
  if (!type || !id) return null
  const name = readText(raw.name)
  const interactionType = readText(raw.interactionType)
  const role = readText(raw.role)
  return {
    type,
    id,
    name: name || undefined,
    interactionType: interactionType || undefined,
    role: role || undefined,
  }
}

export const parseInteractionTargets = (value: unknown): ActivityInteractionTarget[] => {
  if (!Array.isArray(value)) return []
  const deduped = new Map<string, ActivityInteractionTarget>()
  for (const item of value) {
    const normalized = normalizeInteractionTarget(item)
    if (!normalized) continue
    const key = `${normalized.type}:${normalized.id}`
    if (!deduped.has(key)) {
      deduped.set(key, normalized)
    }
  }
  return [...deduped.values()]
}

export const buildCharacterInteractionTargets = (
  characters: Array<{ characterId: string; name?: string }>,
): ActivityInteractionTarget[] => {
  const targets: ActivityInteractionTarget[] = []
  for (const character of characters) {
    const id = readText(character.characterId)
    if (!id) continue
    const name = readText(character.name)
    targets.push({
      type: 'character',
      id,
      name: name || undefined,
      interactionType: 'appears-with',
      role: 'co-actor',
    })
  }
  return targets
}

export const buildInteractionMetadata = (
  subjectCharacterId: string,
  targets: ActivityInteractionTarget[],
): JsonObject => {
  const subjectId = readText(subjectCharacterId)
  const normalizedTargets = targets.filter((target) => !(target.type === 'character' && target.id === subjectId))
  if (normalizedTargets.length === 0) return {}
  return {
    interactionTargets: normalizedTargets,
    interactionTargetIds: normalizedTargets.map((target) => `${target.type}:${target.id}`),
    interactionCharacterIds: normalizedTargets
      .filter((target) => target.type === 'character')
      .map((target) => target.id),
  }
}
