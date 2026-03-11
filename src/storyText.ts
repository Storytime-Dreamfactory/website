export const readTextValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export const isImageActivityType = (activityType: string | undefined): boolean => {
  const normalized = activityType?.trim() ?? ''
  return normalized.startsWith('conversation.image.') || normalized.startsWith('tool.image.')
}

export const readSceneSummaryValue = (
  metadata: Record<string, unknown> | undefined,
): string | undefined =>
  readTextValue(metadata?.sceneSummary) ?? readTextValue(metadata?.storySummary)

export const readImageVisualSummaryValue = (
  metadata: Record<string, unknown> | undefined,
): string | undefined => readTextValue(metadata?.imageVisualSummary)

export const readImagePromptValue = (
  metadata: Record<string, unknown> | undefined,
): string | undefined => readTextValue(metadata?.imagePrompt) ?? readTextValue(metadata?.scenePrompt)

export const readCanonicalStoryText = (input: {
  activityType?: string
  storySummary?: unknown
  metadata?: Record<string, unknown>
  fallbackSummary?: unknown
}): string | undefined => {
  const storySummary = readTextValue(input.storySummary)
  if (storySummary) return storySummary

  const sceneSummary = readSceneSummaryValue(input.metadata)
  if (sceneSummary) return sceneSummary

  const imageVisualSummary = readImageVisualSummaryValue(input.metadata)
  const fallbackSummary =
    readTextValue(input.fallbackSummary) ?? readTextValue(input.metadata?.summary)

  if (isImageActivityType(input.activityType)) {
    return imageVisualSummary ?? fallbackSummary
  }

  return fallbackSummary ?? imageVisualSummary
}
