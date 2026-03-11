import {
  getLatestConversationForCharacter,
  getConversationDetails,
  type ConversationRecord,
  type ConversationMessageRecord,
} from './conversationStore.ts'
import { listActivities, type ActivityRecord } from './activityStore.ts'

export type ConversationInspection = {
  conversation: ConversationRecord
  messages: ConversationMessageRecord[]
  activities: ActivityRecord[]
}

/**
 * Loads the most recently started conversation for a character together with
 * all messages and all activities (public + private) that belong to it.
 */
export const inspectLatestConversation = async (
  characterId: string,
): Promise<ConversationInspection | null> => {
  const details = await getLatestConversationForCharacter(characterId)
  if (!details) return null

  const activities = await listActivities({
    conversationId: details.conversation.conversationId,
    limit: 500,
    offset: 0,
  })

  return {
    conversation: details.conversation,
    messages: details.messages,
    activities,
  }
}

/**
 * Loads a specific conversation by ID together with all messages and
 * all activities (public + private) that belong to it.
 */
export const inspectConversation = async (
  conversationId: string,
): Promise<ConversationInspection | null> => {
  let details
  try {
    details = await getConversationDetails(conversationId)
  } catch {
    return null
  }

  const activities = await listActivities({
    conversationId: details.conversation.conversationId,
    limit: 500,
    offset: 0,
  })

  return {
    conversation: details.conversation,
    messages: details.messages,
    activities,
  }
}
