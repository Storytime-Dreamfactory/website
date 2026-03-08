import type { CharacterAgentSkillPlaybookId } from '../../characterAgentDefinitions.ts'

export type RoutedSkillDecision = {
  skillId: CharacterAgentSkillPlaybookId
  reason: string
}

export type RuntimeIntentContextFlags = {
  relationshipsRequested: boolean
  activitiesRequested: boolean
}

const VISUAL_REQUEST_RE =
  /(bild|szene|zeigen|zeig|schau mal|visualisier|illustrier|zeichn|male|hintergrund)/i
const QUIZ_REQUEST_RE = /(quiz|ratespiel|abfragen|abfrage|frage mich|teste mich|mitmachen)/i
const REFLECTION_RE = /(gefuehl|gefuhl|fuehl|fuhl|ermutig|traurig|gluecklich|mutig|sorge|angst)/i
const EXPLANATION_RE =
  /(warum|wieso|wie|was ist|erklaer|erklaere|erzaehl|erzahl|mehr darueber|mehr daruber|lernen)/i
const ACTIVITY_CONTEXT_RE =
  /(nochmal|wieder|letztes mal|vorhin|schon|bereits|erinn|gezeigt|gemacht|zuletzt)/i
const RELATIONSHIP_CONTEXT_RE =
  /(wer ist|kennst du|beziehung|freund|freundin|familie|mama|papa|bruder|schwester|zusammen)/i
const VISUAL_ASSISTANT_RE = /(ich\s+zeige\s+dir\s+jetzt|schau\s+mal|stell\s+dir\s+vor)/i
const MEMORY_CUE_RE =
  /(erinner|erinnerst|weisst du noch|weißt du noch|damals|frueher|früher|letztes mal|vorherige conversation|fruehere conversation|frühere conversation)/i
const IMAGE_REFERENCE_RE = /(bild|szene|zeigen|gezeigt|wo wir waren|wo wir wa?ren|conversation|unterhaltung)/i

export const isMemoryImageRequest = (userText: string): boolean => {
  const normalized = userText.trim()
  if (!normalized) return false
  if (!IMAGE_REFERENCE_RE.test(normalized)) return false
  return MEMORY_CUE_RE.test(normalized)
}

export const detectRuntimeIntent = (
  lastUserText: string,
  assistantText: string,
): RoutedSkillDecision | null => {
  if (isMemoryImageRequest(lastUserText)) {
    return {
      skillId: 'guided-explanation',
      reason: 'memory-image-request',
    }
  }
  if (VISUAL_REQUEST_RE.test(lastUserText) || VISUAL_ASSISTANT_RE.test(assistantText)) {
    return {
      skillId: 'visual-expression',
      reason: 'visual-request',
    }
  }
  if (QUIZ_REQUEST_RE.test(lastUserText)) {
    return {
      skillId: 'run-quiz',
      reason: 'quiz-request',
    }
  }
  if (REFLECTION_RE.test(lastUserText)) {
    return {
      skillId: 'micro-reflection',
      reason: 'reflection-request',
    }
  }
  if (
    EXPLANATION_RE.test(lastUserText) ||
    ACTIVITY_CONTEXT_RE.test(lastUserText) ||
    RELATIONSHIP_CONTEXT_RE.test(lastUserText)
  ) {
    return {
      skillId: 'guided-explanation',
      reason: 'explanation-request',
    }
  }
  return null
}

export const detectRuntimeIntentContextFlags = (lastUserText: string): RuntimeIntentContextFlags => ({
  relationshipsRequested: RELATIONSHIP_CONTEXT_RE.test(lastUserText),
  activitiesRequested: ACTIVITY_CONTEXT_RE.test(lastUserText) || QUIZ_REQUEST_RE.test(lastUserText),
})
