export const CHARACTER_AGENT_TOOLS = {
  showImage: 'show_image',
  generateImage: 'generate_image',
  displayExistingImage: 'display_existing_image',
  changeBackground: 'change_background',
  grantBadge: 'grant_badge',
  readActivities: 'read_activities',
  readRelationships: 'read_relationships',
} as const

export type CharacterAgentToolId =
  (typeof CHARACTER_AGENT_TOOLS)[keyof typeof CHARACTER_AGENT_TOOLS]

export type CharacterAgentSkillPlaybookId =
  | 'visual-expression'
  | 'run-quiz'
  | 'guided-explanation'
  | 'micro-reflection'
  | 'reward-and-badge'

export type CharacterAgentSkillPlaybook = {
  id: CharacterAgentSkillPlaybookId
  name: string
  purpose: string
  toolIds: CharacterAgentToolId[]
  promptPath: string
}

export const CHARACTER_AGENT_SKILL_PLAYBOOKS: CharacterAgentSkillPlaybook[] = [
  {
    id: 'visual-expression',
    name: 'Visual Expression',
    purpose: 'Macht Inhalte, Gefuehle oder Szenen mit Bildern sichtbar.',
    toolIds: [
      CHARACTER_AGENT_TOOLS.generateImage,
      CHARACTER_AGENT_TOOLS.showImage,
      CHARACTER_AGENT_TOOLS.displayExistingImage,
      CHARACTER_AGENT_TOOLS.changeBackground,
      CHARACTER_AGENT_TOOLS.readRelationships,
    ],
    promptPath: 'content/prompts/agent-skills/visual-expression.md',
  },
  {
    id: 'run-quiz',
    name: 'Run Quiz',
    purpose: 'Fuehrt zu einem Lernziel ein kurzes Quiz oder Abfrageformat durch.',
    toolIds: [CHARACTER_AGENT_TOOLS.grantBadge, CHARACTER_AGENT_TOOLS.showImage],
    promptPath: 'content/prompts/agent-skills/run-quiz.md',
  },
  {
    id: 'guided-explanation',
    name: 'Guided Explanation',
    purpose: 'Erklaert ein Lernziel schrittweise, bildhaft und kindgerecht.',
    toolIds: [CHARACTER_AGENT_TOOLS.showImage, CHARACTER_AGENT_TOOLS.readActivities],
    promptPath: 'content/prompts/agent-skills/guided-explanation.md',
  },
  {
    id: 'micro-reflection',
    name: 'Micro Reflection',
    purpose: 'Regt kurze Selbstbeobachtung oder Rueckfragen an.',
    toolIds: [CHARACTER_AGENT_TOOLS.readActivities],
    promptPath: 'content/prompts/agent-skills/micro-reflection.md',
  },
  {
    id: 'reward-and-badge',
    name: 'Reward And Badge',
    purpose: 'Bestaetigt Lernerfolge und vergibt spaeter Belohnungen.',
    toolIds: [CHARACTER_AGENT_TOOLS.grantBadge, CHARACTER_AGENT_TOOLS.showImage],
    promptPath: 'content/prompts/agent-skills/reward-and-badge.md',
  },
]

export const getCharacterAgentSkillPlaybook = (
  skillId: CharacterAgentSkillPlaybookId,
): CharacterAgentSkillPlaybook | undefined =>
  CHARACTER_AGENT_SKILL_PLAYBOOKS.find((playbook) => playbook.id === skillId)
