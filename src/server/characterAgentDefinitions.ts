export const CHARACTER_AGENT_TOOLS = {
  showImage: 'show_image',
  generateImage: 'generate_image',
  runCliTask: 'run_cli_task',
  readActivities: 'read_activities',
  readConversationHistory: 'read_conversation_history',
  readRelationships: 'read_relationships',
  readRelatedObjects: 'read_related_objects',
  readRelatedObjectContexts: 'read_related_object_contexts',
} as const

export type CharacterAgentToolId =
  (typeof CHARACTER_AGENT_TOOLS)[keyof typeof CHARACTER_AGENT_TOOLS]

export type CharacterAgentSkillPlaybookId =
  | 'remember-something'
  | 'do-something'
  | 'request-context'
  | 'visual-expression'
  | 'run-quiz'
  | 'guided-explanation'
  | 'micro-reflection'

export type CharacterAgentSkillPlaybook = {
  id: CharacterAgentSkillPlaybookId
  name: string
  purpose: string
  toolIds: CharacterAgentToolId[]
  promptPath: string
}

export const CHARACTER_AGENT_SKILL_PLAYBOOKS: CharacterAgentSkillPlaybook[] = [
  {
    id: 'remember-something',
    name: 'Remember Something',
    purpose: 'Erinnert sich an Erlebtes und zeigt bei Bedarf bestehende Bilder.',
    toolIds: [
      CHARACTER_AGENT_TOOLS.showImage,
      CHARACTER_AGENT_TOOLS.readActivities,
      CHARACTER_AGENT_TOOLS.readConversationHistory,
      CHARACTER_AGENT_TOOLS.readRelatedObjects,
      CHARACTER_AGENT_TOOLS.readRelatedObjectContexts,
    ],
    promptPath: 'content/prompts/agent-skills/remember-something.md',
  },
  {
    id: 'do-something',
    name: 'Do Something',
    purpose: 'Fuehrt eine angefragte Aktion aus und erzeugt bei Bedarf neue Szenen.',
    toolIds: [
      CHARACTER_AGENT_TOOLS.readActivities,
      CHARACTER_AGENT_TOOLS.showImage,
      CHARACTER_AGENT_TOOLS.generateImage,
      CHARACTER_AGENT_TOOLS.runCliTask,
      CHARACTER_AGENT_TOOLS.readRelatedObjects,
      CHARACTER_AGENT_TOOLS.readRelatedObjectContexts,
    ],
    promptPath: 'content/prompts/agent-skills/do-something.md',
  },
  {
    id: 'request-context',
    name: 'Request Context',
    purpose: 'Laedt fehlenden Kontext aus Beziehungen und verknuepften Objekten nach.',
    toolIds: [
      CHARACTER_AGENT_TOOLS.readRelationships,
      CHARACTER_AGENT_TOOLS.readRelatedObjects,
      CHARACTER_AGENT_TOOLS.readRelatedObjectContexts,
    ],
    promptPath: 'content/prompts/agent-skills/request-context.md',
  },
]

export const getCharacterAgentSkillPlaybook = (
  skillId: CharacterAgentSkillPlaybookId,
): CharacterAgentSkillPlaybook | undefined =>
  CHARACTER_AGENT_SKILL_PLAYBOOKS.find((playbook) => playbook.id === skillId)
