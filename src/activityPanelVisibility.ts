type ActivityLike = {
  activityType: string
  isPublic: boolean
  object?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

const PANEL_IMAGE_ACTIVITY_TYPES = new Set([
  'conversation.image.generated',
  'conversation.image.recalled',
])
const PANEL_SUMMARY_ACTIVITY_TYPES = new Set(['conversation.story.summarized'])
const PANEL_CONVERSATION_BOUNDARY_ACTIVITY_TYPES = new Set(['character.chat.completed'])

const readTextValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

export const isPanelImageActivity = (activity: Pick<ActivityLike, 'activityType' | 'isPublic'>): boolean => {
  return activity.isPublic === true && PANEL_IMAGE_ACTIVITY_TYPES.has(activity.activityType)
}

export const isPanelConversationMessageActivity = (activity: ActivityLike): boolean => {
  if (activity.isPublic !== true || activity.activityType !== 'conversation.message.created') return false
  const role = readTextValue(activity.object?.role) ?? readTextValue(activity.metadata?.messageRole)
  return role === 'user' || role === 'assistant'
}

export const isPanelConversationSummaryActivity = (
  activity: Pick<ActivityLike, 'activityType' | 'isPublic'>,
): boolean => {
  return activity.isPublic === true && PANEL_SUMMARY_ACTIVITY_TYPES.has(activity.activityType)
}

export const isPanelConversationBoundaryActivity = (
  activity: Pick<ActivityLike, 'activityType' | 'isPublic'>,
): boolean => {
  return activity.isPublic === true && PANEL_CONVERSATION_BOUNDARY_ACTIVITY_TYPES.has(activity.activityType)
}

export const shouldShowActivityInPanel = (activity: ActivityLike): boolean => {
  return (
    isPanelImageActivity(activity) ||
    isPanelConversationSummaryActivity(activity)
  )
}
