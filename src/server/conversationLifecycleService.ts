import type { ConversationRecord } from './conversationStore.ts'

const DEFAULT_TIMEOUT_MS = 4_000

export type ConversationEndedEvent = {
  event: 'conversation.ended'
  triggeredAt: string
  conversation: ConversationRecord
}

const getWebhookUrl = (): string => process.env.CONVERSATION_END_WEBHOOK_URL?.trim() || ''

const getWebhookTimeoutMs = (): number => {
  const raw = process.env.CONVERSATION_END_WEBHOOK_TIMEOUT_MS?.trim()
  const parsed = raw ? Number(raw) : DEFAULT_TIMEOUT_MS
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS
  }
  return Math.floor(parsed)
}

export const triggerConversationEndedService = async (
  conversation: ConversationRecord,
): Promise<void> => {
  const webhookUrl = getWebhookUrl()
  if (!webhookUrl) {
    return
  }

  const eventPayload: ConversationEndedEvent = {
    event: 'conversation.ended',
    triggeredAt: new Date().toISOString(),
    conversation,
  }

  const secret = process.env.CONVERSATION_END_WEBHOOK_SECRET?.trim()
  const timeoutMs = getWebhookTimeoutMs()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (secret) {
    headers['X-Conversation-Webhook-Secret'] = secret
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(eventPayload),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Webhook returned ${response.status}: ${body}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Conversation end webhook failed: ${message}`)
  }
}
