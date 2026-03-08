import type { CharacterAgentSkillPlaybookId } from '../../characterAgentDefinitions.ts'

export type RoutedSkillDecision = {
  skillId: CharacterAgentSkillPlaybookId
  reason: string
}

export type RuntimeIntentContextFlags = {
  relationshipsRequested: boolean
  activitiesRequested: boolean
}

export type RuntimeToolExecutionIntent = {
  taskId: 'character_images_dry_run' | 'character_images_generate' | 'runtime_smoke'
  dryRun: boolean
  reason: string
  args?: Record<string, unknown>
}

export type RuntimeIntentModelDecision = {
  decision: RoutedSkillDecision | null
  flags: RuntimeIntentContextFlags
  source: 'llm' | 'fallback'
}

const MEMORY_CUE_RE =
  /(erinner|erinnerst|weisst du noch|weißt du noch|damals|frueher|früher|letztes mal|vorherige conversation|fruehere conversation|frühere conversation)/i
const IMAGE_REFERENCE_RE = /(bild|szene|zeigen|gezeigt|wo wir waren|wo wir wa?ren|conversation|unterhaltung)/i
const RETRIEVE_VERB_RE = /(zeig|zeige|finde|such|suche|hol|hole|nimm)/i
const OLDER_OR_CHANGE_RE =
  /(aelter|älter|aenderung|änderung|alte[srn]?|frueher|früher|damals|nochmal|wieder)/i
const GLITTER_STONE_RE = /(glitzer[a-z]*\s+stein|stein[a-z\s]*glitzer|glitzer[a-z\s]*stein)/i
const PERSON_MEMORY_LOOKUP_RE =
  /(hast du.*(mit|von)\s+[a-zA-ZäöüÄÖÜß-]{3,}|(mit|von)\s+[a-zA-ZäöüÄÖÜß-]{3,}.*(erlebt|gemacht|gesehen|erinn))/i
const PERSON_CONTEXT_LOOKUP_RE =
  /(andere[nr]? person(en)?|mit wem|wer war dabei|wer noch|mit anderen|an andere erinnern)/i
const VISUAL_PERSON_REFERENCE_CAPTURE_RE =
  /(bild|szene|zeigen|gezeigt).*(?:mit|von)\s+([a-zA-ZäöüÄÖÜß-]{3,})/i
const NON_PERSON_REFERENCE_WORDS = new Set([
  'einem',
  'einer',
  'einen',
  'eines',
  'dem',
  'den',
  'der',
  'die',
  'das',
  'mein',
  'meinem',
  'dein',
  'deinem',
  'unserem',
  'eurem',
  'mir',
  'dir',
])
const CLI_OR_SCRIPT_RE = /(cli|script|skript|kommando|command|terminal|ausfuehren|ausführen|starte|run)/i
const CHARACTER_IMAGE_TASK_RE =
  /(character[\s-]?images?|charakterbilder?|character-bilder|figur(en)?bilder?|asset(s)? generieren)/i
const RUNTIME_SMOKE_TASK_RE = /(runtime smoke|smoke test|smoketest)/i
const DRY_RUN_RE = /(dry run|trockenlauf|preview|vorschau|nur pruefen|nur prüfen)/i
const EXECUTE_RE = /(ausfuehren|ausführen|starte|jetzt|run|execute|mach)/i
const SMOKE_MODE_RE = /mode\s*[:=]?\s*(visual|quiz|context|memory-image|smoke)/i
const BOOL_TRUE_RE = /\btrue\b/i
const BOOL_FALSE_RE = /\bfalse\b/i
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const RUNTIME_INTENT_MODEL = process.env.RUNTIME_INTENT_MODEL?.trim() || 'gpt-5-mini'
const RUNTIME_INTENT_TIMEOUT_MS = 2_500

const parseFlagFromText = (text: string, labels: string[]): boolean | null => {
  const normalized = text.toLowerCase()
  for (const label of labels) {
    const index = normalized.indexOf(label)
    if (index < 0) continue
    const tail = normalized.slice(index, index + label.length + 32)
    if (BOOL_TRUE_RE.test(tail)) return true
    if (BOOL_FALSE_RE.test(tail)) return false
  }
  return null
}

const SKILL_ALIASES: Array<{ aliases: string[]; skillId: CharacterAgentSkillPlaybookId }> = [
  {
    aliases: [
      'remember-something',
      'remember_something',
      'remember something',
      'remember',
      'memory',
      'guided-explanation',
      'guided_explanation',
      'guided explanation',
    ],
    skillId: 'remember-something',
  },
  {
    aliases: [
      'do-something',
      'do_something',
      'do something',
      'action',
      'do',
      'visual-expression',
      'visual_expression',
      'visual expression',
      'run-quiz',
      'run_quiz',
      'run quiz',
    ],
    skillId: 'do-something',
  },
  {
    aliases: [
      'request-context',
      'request_context',
      'request context',
      'context',
      'micro-reflection',
      'micro_reflection',
      'micro reflection',
    ],
    skillId: 'request-context',
  },
]

const parseSkillIdFromText = (text: string, labels: string[]): CharacterAgentSkillPlaybookId | null => {
  const normalized = text.toLowerCase()
  for (const label of labels) {
    const index = normalized.indexOf(label)
    if (index < 0) continue
    const tail = normalized.slice(index, index + label.length + 64)
    for (const entry of SKILL_ALIASES) {
      if (entry.aliases.some((alias) => tail.includes(alias))) {
        return entry.skillId
      }
    }
  }
  return null
}

const parseReasonFromText = (text: string): string | null => {
  const normalized = text.toLowerCase()
  const labels = ['reason', 'routingreason', 'decisionreason']
  for (const label of labels) {
    const index = normalized.indexOf(label)
    if (index < 0) continue
    const tail = normalized.slice(index)
    const quotedMatch = tail.match(/["']?reason["']?\s*[:=]\s*["']([^"']{2,80})["']/i)
    if (quotedMatch && quotedMatch[1]) return quotedMatch[1].trim()
    const plainMatch = tail.match(/reason\s*[:=]\s*([a-z0-9._-]{2,80})/i)
    if (plainMatch && plainMatch[1]) return plainMatch[1].trim()
  }
  return null
}

const decideRuntimeSkillFromModelOutput = (
  lastUserText: string,
  assistantText: string,
): RoutedSkillDecision | null => {
  const labels = ['skillid', 'skill_id', 'skill', 'requestedskill', 'routedskillid', 'routedskill']
  const skillId =
    parseSkillIdFromText(lastUserText, labels) ?? parseSkillIdFromText(assistantText, labels)
  if (!skillId) return null
  const reason =
    parseReasonFromText(lastUserText) ??
    parseReasonFromText(assistantText) ??
    'model-skill-decision'
  return { skillId, reason }
}

const toNormalizedSkillId = (value: unknown): CharacterAgentSkillPlaybookId | null => {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (normalized === 'remember-something') return 'remember-something'
  if (normalized === 'do-something') return 'do-something'
  if (normalized === 'request-context') return 'request-context'
  if (normalized === 'guided-explanation') return 'remember-something'
  if (normalized === 'visual-expression') return 'do-something'
  if (normalized === 'run-quiz') return 'do-something'
  if (normalized === 'micro-reflection') return 'request-context'
  return null
}

const parseJsonObject = (raw: string): Record<string, unknown> | null => {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    const parsed = JSON.parse(withoutFence)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

const requestRuntimeIntentFromLlm = async (
  lastUserText: string,
  assistantText: string,
): Promise<RuntimeIntentModelDecision | null> => {
  if (process.env.NODE_ENV === 'test') return null
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), RUNTIME_INTENT_TIMEOUT_MS)
  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: RUNTIME_INTENT_MODEL,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Du bist ein Runtime-Router fuer Storytime. Gib ausschliesslich JSON zur Routing-Entscheidung zurueck. Klassifiziere strikt nach diesen Definitionen: activitiesRequested=true fuer Erinnerungen, zeitliche Rueckblicke, Gespraechsverlauf, "wann", "was war zuerst/zuletzt", Ereignisse und Conversation-Historie. relationshipsRequested=true fuer Ontologie-/Beziehungswissen: Freundschaften, Verwandtschaft, Herkunft, Orte, Besitz/zugeordnete Objekte und Beziehungstypen. Wenn eine Frage nach vergangenem Gespraechsverlauf fragt, ist das Activity (nicht Relationship). Beide Flags duerfen gleichzeitig true sein, falls beides explizit gefragt wird. Waehle skillId passend zur Anfrage aus: remember-something, do-something, request-context. Bei reiner Kontextabfrage ist request-context korrekt.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              lastUserText,
              assistantText,
              allowedSkillIds: [
                'remember-something',
                'do-something',
                'request-context',
              ],
              outputRules: {
                mustReturnJsonOnly: true,
                activitiesRequested: 'boolean',
                relationshipsRequested: 'boolean',
                skillIdOrNull: 'string|null',
                reason: 'string',
              },
            }),
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'runtime_intent_decision',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                activitiesRequested: { type: 'boolean' },
                relationshipsRequested: { type: 'boolean' },
                skillId: {
                  anyOf: [
                    {
                      type: 'string',
                      enum: [
                        'remember-something',
                        'do-something',
                        'request-context',
                      ],
                    },
                    { type: 'null' },
                  ],
                },
                reason: { type: 'string' },
              },
              required: ['activitiesRequested', 'relationshipsRequested', 'skillId', 'reason'],
            },
          },
        },
      }),
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = body?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return null
    const parsed = parseJsonObject(content)
    if (!parsed) return null
    const skillId = toNormalizedSkillId(parsed.skillId)
    const reason = typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : 'llm'
    return {
      decision: skillId ? { skillId, reason } : null,
      flags: {
        activitiesRequested: parsed.activitiesRequested === true,
        relationshipsRequested: parsed.relationshipsRequested === true,
      },
      source: 'llm',
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

const decideRuntimeIntentContextFlagsFromModelOutput = (
  lastUserText: string,
  assistantText: string,
): RuntimeIntentContextFlags => {
  const relationshipLabels = [
    'relationshipsrequested',
    'relationshiprequested',
    'relationships requested',
    'relationship requested',
  ]
  const activityLabels = [
    'activitiesrequested',
    'activityrequested',
    'activities requested',
    'activity requested',
  ]
  const relationshipFlag =
    parseFlagFromText(lastUserText, relationshipLabels) ??
    parseFlagFromText(assistantText, relationshipLabels)
  const activityFlag =
    parseFlagFromText(lastUserText, activityLabels) ?? parseFlagFromText(assistantText, activityLabels)
  return {
    relationshipsRequested: relationshipFlag === true,
    activitiesRequested: activityFlag === true,
  }
}

export const isMemoryImageRequest = (userText: string): boolean => {
  const normalized = userText.trim()
  if (!normalized) return false
  const hasImageReference = IMAGE_REFERENCE_RE.test(normalized)
  const hasMemoryCue = MEMORY_CUE_RE.test(normalized)
  const hasPersonMemoryLookup = PERSON_MEMORY_LOOKUP_RE.test(normalized)
  const hasPersonContextLookup = PERSON_CONTEXT_LOOKUP_RE.test(normalized)
  const visualPersonReferenceMatch = normalized.match(VISUAL_PERSON_REFERENCE_CAPTURE_RE)
  const referencedToken = visualPersonReferenceMatch?.[2]?.toLowerCase()
  const hasVisualNamedPersonReference = Boolean(
    referencedToken && !NON_PERSON_REFERENCE_WORDS.has(referencedToken),
  )
  if (hasImageReference && hasMemoryCue) return true
  if (hasPersonMemoryLookup) return true
  if (hasMemoryCue && hasPersonContextLookup) return true
  if (hasImageReference && (hasPersonContextLookup || hasVisualNamedPersonReference)) return true
  return false
}

export const detectRuntimeIntent = (
  lastUserText: string,
  assistantText: string,
): RoutedSkillDecision | null => {
  if (isMemoryImageRequest(lastUserText)) {
    return {
      skillId: 'remember-something',
      reason: 'memory-image-request',
    }
  }
  const normalized = lastUserText.trim()
  if (normalized) {
    const asksOlderOrChangedVisual = RETRIEVE_VERB_RE.test(normalized) && OLDER_OR_CHANGE_RE.test(normalized)
    if (asksOlderOrChangedVisual) {
      return {
        skillId: 'remember-something',
        reason: 'older-change-memory-request',
      }
    }
    if (GLITTER_STONE_RE.test(normalized)) {
      return {
        skillId: 'remember-something',
        reason: 'glitter-stone-memory-request',
      }
    }
  }
  return decideRuntimeSkillFromModelOutput(lastUserText, assistantText)
}

export const detectRuntimeIntentContextFlags = (
  lastUserText: string,
  assistantText = '',
): RuntimeIntentContextFlags => decideRuntimeIntentContextFlagsFromModelOutput(lastUserText, assistantText)

export const detectRuntimeIntentModelDecision = async (
  lastUserText: string,
  assistantText: string,
): Promise<RuntimeIntentModelDecision> => {
  const memoryRequest = isMemoryImageRequest(lastUserText)
  if (memoryRequest) {
    return {
      decision: {
        skillId: 'remember-something',
        reason: 'memory-image-request',
      },
      flags: {
        activitiesRequested: false,
        relationshipsRequested: false,
      },
      source: 'fallback',
    }
  }
  const llmDecision = await requestRuntimeIntentFromLlm(lastUserText, assistantText)
  if (llmDecision) return llmDecision
  return {
    decision: detectRuntimeIntent(lastUserText, assistantText),
    flags: detectRuntimeIntentContextFlags(lastUserText, assistantText),
    source: 'fallback',
  }
}

export const detectRuntimeToolExecutionIntent = (
  lastUserText: string,
): RuntimeToolExecutionIntent | null => {
  const normalized = lastUserText.trim()
  if (!normalized) return null
  if (!CLI_OR_SCRIPT_RE.test(normalized)) return null

  if (RUNTIME_SMOKE_TASK_RE.test(normalized)) {
    const modeMatch = normalized.match(SMOKE_MODE_RE)
    return {
      taskId: 'runtime_smoke',
      dryRun: DRY_RUN_RE.test(normalized),
      reason: 'runtime-smoke-request',
      args: modeMatch ? { mode: modeMatch[1].toLowerCase() } : undefined,
    }
  }

  if (CHARACTER_IMAGE_TASK_RE.test(normalized)) {
    const wantsExecute = EXECUTE_RE.test(normalized) && !DRY_RUN_RE.test(normalized)
    return {
      taskId: wantsExecute ? 'character_images_generate' : 'character_images_dry_run',
      dryRun: !wantsExecute,
      reason: wantsExecute ? 'character-images-generate-request' : 'character-images-dry-run-request',
    }
  }

  return null
}
