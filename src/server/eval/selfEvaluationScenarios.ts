export type SelfEvaluationScenarioId = 'memory' | 'image' | 'chat' | 'mixed'

export type SelfEvaluationTurn = {
  userText: string
  assistantText: string
}

export type SelfEvaluationScenario = {
  id: SelfEvaluationScenarioId
  title: string
  goal: string
  turns: SelfEvaluationTurn[]
}

const SCENARIOS: Record<SelfEvaluationScenarioId, SelfEvaluationScenario> = {
  memory: {
    id: 'memory',
    title: 'Memory und Rueckbezug',
    goal: 'Der Character soll fruehere Szene/Bild wieder aufgreifen und sinnvoll erinnern.',
    turns: [
      {
        userText: 'Kannst du mir bitte ein Bild von uns auf dem moosigen Waldweg zeigen?',
        assistantText: 'Ja, ich beschreibe gleich eine Szene auf dem Waldweg fuer dich.',
      },
      {
        userText: 'Weisst du noch unser Bild von eben? Zeig bitte genau das nochmal.',
        assistantText: 'Ich erinnere mich und hole unser Bild nochmal dazu.',
      },
    ],
  },
  image: {
    id: 'image',
    title: 'Bildfokus und Folgefrage',
    goal: 'Der Character soll ein Bild erzeugen und danach kindgerecht darauf eingehen.',
    turns: [
      {
        userText: 'Ich will ein Bild mit einem freundlichen Otter und einer kleinen Laterne sehen.',
        assistantText: 'Klar, ich zeige dir gleich ein passendes Bild.',
      },
      {
        userText: 'Was sieht man da genau und warum wirkt es so freundlich?',
        assistantText: 'Ich erklaere dir die Szene ganz einfach und freundlich.',
      },
    ],
  },
  chat: {
    id: 'chat',
    title: 'Nur Gespraech',
    goal: 'Der Character soll ohne Bildwunsch ein gutes, kindgerechtes Gespraech fuehren.',
    turns: [
      {
        userText: 'Heute war ich mutig beim Klettern, aber ich hatte auch etwas Angst.',
        assistantText: 'Das war stark von dir, ich hoere dir zu.',
      },
      {
        userText: 'Wie kann ich beim naechsten Mal mutig bleiben, ohne zu schnell zu werden?',
        assistantText: 'Lass uns einen kleinen Schritt-fuer-Schritt-Plan machen.',
      },
    ],
  },
  mixed: {
    id: 'mixed',
    title: 'Themenwechsel',
    goal: 'Der Character soll bei Off-topic/Topic-Switch robust bleiben.',
    turns: [
      {
        userText: 'Erst moechte ich ueber mein kaputtes Fahrrad reden und dann ueber Sterne.',
        assistantText: 'Okay, wir sortieren beides zusammen.',
      },
      {
        userText: 'Jetzt bitte Sterne, aber nicht zu schwer erklaert, ich bin noch klein.',
        assistantText: 'Ich erklaere es einfach und kindgerecht.',
      },
    ],
  },
}

export const DEFAULT_SELF_EVALUATION_SCENARIOS: SelfEvaluationScenarioId[] = [
  'memory',
  'image',
  'chat',
  'mixed',
]

export const listSelfEvaluationScenarioIds = (): SelfEvaluationScenarioId[] =>
  DEFAULT_SELF_EVALUATION_SCENARIOS.slice()

export const getSelfEvaluationScenario = (id: SelfEvaluationScenarioId): SelfEvaluationScenario =>
  SCENARIOS[id]

export const parseSelfEvaluationScenarioIds = (
  value: string | undefined,
): SelfEvaluationScenarioId[] => {
  if (!value || !value.trim()) return listSelfEvaluationScenarioIds()
  const ids = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)

  const parsed: SelfEvaluationScenarioId[] = []
  for (const id of ids) {
    if (id === 'memory' || id === 'image' || id === 'chat' || id === 'mixed') {
      parsed.push(id)
    }
  }
  return parsed.length > 0 ? parsed : listSelfEvaluationScenarioIds()
}
