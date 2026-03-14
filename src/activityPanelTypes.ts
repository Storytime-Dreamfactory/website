export type CharacterActivityItem = {
  id: string
  timestamp: string | Date
  isPublic?: boolean
  rawActivityType?: string
  subject: string
  activityType: string
  object: string
  summary?: string
  conversationId?: string
  conversationUrl?: string
  conversationLabel?: string
  imageUrl?: string
  imageUrls?: string[]
  imageLabel?: string
  imagePrompt?: string
  isPending?: boolean
  summaryCharacters?: Array<{ id: string; name: string }>
}
