import { CHARACTER_AGENT_TOOLS } from '../characterAgentDefinitions.ts'

const PROMPT_CATALOG = [
  { id: 'intent-router', path: 'content/prompts/runtime/intent-router-system.md' },
  { id: 'scene-summary', path: 'content/prompts/runtime/scene-summary-system.md' },
  { id: 'image-prompt', path: 'content/prompts/runtime/image-prompt-system.md' },
  { id: 'character-voice', path: 'content/prompts/character-voice-agent.md' },
  { id: 'self-evaluation', path: 'content/prompts/runtime/self-evaluation-system.md' },
]

const CONTEXT_TOOL_CATALOG = [
  { id: CHARACTER_AGENT_TOOLS.readActivities, purpose: 'Public/Private Activities lesen' },
  {
    id: CHARACTER_AGENT_TOOLS.readConversationHistory,
    purpose: 'Conversation-Verlauf und Bildreferenzen lesen',
  },
  { id: CHARACTER_AGENT_TOOLS.readRelationships, purpose: 'Character-Beziehungen lesen' },
  { id: CHARACTER_AGENT_TOOLS.readRelatedObjects, purpose: 'bezogene Charaktere/Objekte lesen' },
  {
    id: CHARACTER_AGENT_TOOLS.readRelatedObjectContexts,
    purpose: 'konkrete Objektkontexte aus Relationships lesen',
  },
  { id: CHARACTER_AGENT_TOOLS.showImage, purpose: 'bestehende Bilder erinnern/anzeigen' },
]

const ROUTING_AND_FLAGS = [
  'Intent Router: detectRuntimeIntentModelDecision(...) waehlt Skill',
  'Skill IDs: create_scene, remember-something, request-context, evaluate-feedback',
  'Kontext-Flags: activitiesRequested, relationshipsRequested',
]

export const buildSelfEvaluationRuntimeContextText = (): string => {
  const promptLines = PROMPT_CATALOG.map((entry) => `- ${entry.id}: ${entry.path}`)
  const toolLines = CONTEXT_TOOL_CATALOG.map((entry) => `- ${entry.id}: ${entry.purpose}`)
  const flowLines = ROUTING_AND_FLAGS.map((entry) => `- ${entry}`)
  return [
    'Aktuelle Prompt-Dateien:',
    ...promptLines,
    '',
    'Aktuelle Context-Tools:',
    ...toolLines,
    '',
    'Aktuelle Routing-/Runtime-Kontexte:',
    ...flowLines,
  ].join('\n')
}
