export type ConversationRuntimeContext = {
  placeId?: string
  learningGoalIds?: string[]
}

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export const contextFromMetadata = (
  metadata: Record<string, unknown> | undefined,
): ConversationRuntimeContext => {
  if (!metadata) return {}

  const placeCandidate = metadata.placeId ?? metadata.place_id
  const placeId = typeof placeCandidate === 'string' ? placeCandidate.trim() : ''
  const learningGoalIdsFromArray = toStringArray(
    metadata.learningGoalIds ??
      metadata.learning_goal_ids ??
      metadata.skillIds ??
      metadata.skill_ids,
  )
  const singleLearningGoal =
    typeof metadata.learningGoalId === 'string'
      ? metadata.learningGoalId.trim()
      : typeof metadata.skillId === 'string'
        ? metadata.skillId.trim()
        : ''
  const combinedLearningGoals = Array.from(
    new Set(
      [...learningGoalIdsFromArray, ...(singleLearningGoal ? [singleLearningGoal] : [])].filter(
        (item) => item.length > 0,
      ),
    ),
  )

  return {
    placeId: placeId || undefined,
    learningGoalIds: combinedLearningGoals.length > 0 ? combinedLearningGoals : undefined,
  }
}
