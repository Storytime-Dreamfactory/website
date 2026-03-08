import type { CharacterAgentToolId } from '../../characterAgentDefinitions.ts'

export type RuntimeToolContext = {
  conversationId: string
  characterId: string
  characterName: string
  learningGoalIds?: string[]
}

export type RuntimeToolHandler<TInput, TOutput> = {
  id: CharacterAgentToolId
  execute: (context: RuntimeToolContext, input: TInput) => Promise<TOutput>
}
