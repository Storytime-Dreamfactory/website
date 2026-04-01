export const CHARACTER_AGENT_TOOLS = {
  showImage: 'show_image',
  generateImage: 'generate_image',
  readActivities: 'read_activities',
  readConversationHistory: 'read_conversation_history',
  readRelationships: 'read_relationships',
  readRelatedObjects: 'read_related_objects',
  readRelatedObjectContexts: 'read_related_object_contexts',
} as const

export type CharacterAgentToolId =
  (typeof CHARACTER_AGENT_TOOLS)[keyof typeof CHARACTER_AGENT_TOOLS]

export type CharacterAgentSkillPlaybookId =
  | 'plan-and-act'
  | 'remember-something'
  | 'create_scene'
  | 'request-context'
  | 'evaluate-feedback'
  | 'run-quiz'
  // Legacy aliases bleiben fuer Rueckwaertskompatibilitaet im Typ bestehen.
  | 'visual-expression'
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
    id: 'plan-and-act',
    name: 'Plan And Act',
    purpose:
      'Plant mehrschrittige Requests im Turn und fuehrt sie sequenziell ueber Runtime-Tools aus.',
    toolIds: [
      CHARACTER_AGENT_TOOLS.readActivities,
      CHARACTER_AGENT_TOOLS.readConversationHistory,
      CHARACTER_AGENT_TOOLS.readRelationships,
      CHARACTER_AGENT_TOOLS.readRelatedObjects,
      CHARACTER_AGENT_TOOLS.readRelatedObjectContexts,
      CHARACTER_AGENT_TOOLS.showImage,
      CHARACTER_AGENT_TOOLS.generateImage,
    ],
    promptPath: 'content/prompts/agent-skills/plan-and-act.md',
  },
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
    id: 'create_scene',
    name: 'Create Scene',
    purpose: 'Fuehrt eine angefragte Aktion aus und erzeugt bei Bedarf neue Szenen.',
    toolIds: [
      CHARACTER_AGENT_TOOLS.readActivities,
      CHARACTER_AGENT_TOOLS.readRelationships,
      CHARACTER_AGENT_TOOLS.showImage,
      CHARACTER_AGENT_TOOLS.generateImage,
      CHARACTER_AGENT_TOOLS.readRelatedObjects,
      CHARACTER_AGENT_TOOLS.readRelatedObjectContexts,
    ],
    promptPath: 'content/prompts/agent-skills/create_scene.md',
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
  {
    id: 'evaluate-feedback',
    name: 'Evaluate Feedback',
    purpose: 'Nimmt Meta-Feedback zur Qualitaet entgegen und startet einen asynchronen Verbesserungs-Flow.',
    toolIds: [],
    promptPath: 'content/prompts/agent-skills/evaluate-feedback.md',
  },
  {
    id: 'run-quiz',
    name: 'Run Quiz',
    purpose: 'Startet einen Quiz-Durchlauf fuer die laufende Conversation.',
    toolIds: [CHARACTER_AGENT_TOOLS.readActivities],
    promptPath: 'content/prompts/agent-skills/create_scene.md',
  },
]

export const getCharacterAgentSkillPlaybook = (
  skillId: CharacterAgentSkillPlaybookId,
): CharacterAgentSkillPlaybook | undefined =>
  CHARACTER_AGENT_SKILL_PLAYBOOKS.find((playbook) => playbook.id === skillId)
