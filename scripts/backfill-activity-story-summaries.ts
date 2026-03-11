import { Pool } from 'pg'

const POSTGRES_DEFAULT_URL = 'postgres://storytime:storytime@localhost:5433/storytime'
const STORY_SUMMARY_MODEL = process.env.RUNTIME_ACTIVITY_STORY_SUMMARY_MODEL?.trim() || 'gpt-5-mini'
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_LIMIT = 500

type ActivityData = Record<string, unknown>

type ActivityRow = {
  activity_id: string
  activity_type: string
  is_public: boolean
  character_id: string | null
  place_id: string | null
  learning_goal_ids: string[] | null
  skill_ids: string[] | null
  conversation_id: string | null
  subject: ActivityData | null
  object: ActivityData | null
  metadata: ActivityData | null
  story_summary: string | null
  occurred_at: string
  created_at: string
}

type ActivityRecord = {
  activityId: string
  activityType: string
  characterId?: string
  subject: ActivityData
  object: ActivityData
  metadata: ActivityData
  storySummary?: string
  occurredAt: string
}

const toRecord = (row: ActivityRow): ActivityRecord => ({
  activityId: row.activity_id,
  activityType: row.activity_type,
  characterId: row.character_id ?? undefined,
  subject: row.subject ?? {},
  object: row.object ?? {},
  metadata: row.metadata ?? {},
  storySummary: row.story_summary ?? undefined,
  occurredAt: new Date(row.occurred_at).toISOString(),
})

const readText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const normalizeStorySummary = (value: string): string => {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= 360) return compact
  return `${compact.slice(0, 357)}...`
}

const PROMPT_NOISE_RE =
  /SZENE FUER BILDERGESCHICHTE|WAS DAS KIND JETZT WILL:|WAS IM LETZTEN BILD ZU SEHEN WAR:|Du erzeugst die NAECHSTE Szene|AKTUELLER REQUEST|VISUELLE KONTINUITAET|SZENENKERN:|AUFGABE:|LETZTE STORY-AKTIVITAETEN/i
const STORYBOOK_ACTIVITY_TYPES = new Set(['conversation.image.generated', 'conversation.image.recalled'])

const readTextList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

const readInteractionCharacterNames = (metadata: ActivityData): string[] => {
  const names = new Set<string>()
  for (const name of readTextList(metadata.relatedCharacterNames)) {
    names.add(name)
  }
  const rawTargets = metadata.interactionTargets
  if (Array.isArray(rawTargets)) {
    for (const value of rawTargets) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const target = value as Record<string, unknown>
      const type = readText(target.type).toLowerCase()
      const name = readText(target.name)
      if (type === 'character' && name) names.add(name)
    }
  }
  return [...names]
}

const sanitizeFallbackSummary = (value: string): string | null => {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!PROMPT_NOISE_RE.test(trimmed)) return trimmed
  const cleaned = trimmed
    .replace(/^[^:]+zeigt ein neues Bild:\s*/i, '')
    .replace(/^SZENE FUER BILDERGESCHICHTE\s*/i, '')
  const wishMatch = cleaned.match(/WAS DAS KIND JETZT WILL:\s*([^\n]+)/i)
  if (wishMatch?.[1]?.trim()) return wishMatch[1].trim()
  return null
}

const buildStoryActors = (characterName: string, relatedCharacterNames: string[]): string => {
  const others = relatedCharacterNames.filter((item) => item !== characterName)
  if (others.length === 0) return characterName
  if (others.length === 1) return `${characterName} und ${others[0]}`
  return `${characterName} und ${others.slice(0, -1).join(', ')} und ${others[others.length - 1]}`
}

const buildStoryVerb = (actors: string): string => (actors.includes(' und ') ? 'erlebten' : 'erlebte')

const summarizeActivityFallback = (activity: ActivityRecord): string => {
  const metadataSummary = readText((activity.metadata as Record<string, unknown>)?.summary)
  const cleanedMeta = metadataSummary ? sanitizeFallbackSummary(metadataSummary) : null
  const characterName =
    readText((activity.subject as Record<string, unknown>)?.name) ||
    activity.characterId ||
    'eine Figur'
  const relatedCharacterNames = readInteractionCharacterNames(activity.metadata)
  const actors = buildStoryActors(characterName, relatedCharacterNames)
  const verb = buildStoryVerb(actors)
  if (STORYBOOK_ACTIVITY_TYPES.has(activity.activityType)) {
    if (cleanedMeta) {
      return normalizeStorySummary(`Es war einmal vor langer, langer Zeit, da ${actors} Folgendes ${verb}: ${cleanedMeta}`)
    }
    const visualSummary = readText((activity.metadata as Record<string, unknown>)?.imageVisualSummary)
    if (visualSummary) {
      return normalizeStorySummary(`Es war einmal vor langer, langer Zeit, da ${actors} Folgendes ${verb}: ${visualSummary}`)
    }
  }
  if (cleanedMeta) return normalizeStorySummary(cleanedMeta)
  return normalizeStorySummary(
    `Es war einmal vor langer, langer Zeit – ${actors} ${verb} etwas Neues.`,
  )
}

const shouldGenerateStorySummary = (activity: ActivityRecord): boolean => {
  if (!activity.characterId) return false
  if (activity.activityType.startsWith('trace.')) return false
  if (activity.activityType.startsWith('tool.')) return false
  if (activity.activityType.startsWith('skill.')) return false
  if (activity.activityType.startsWith('runtime.')) return false
  if (activity.activityType === 'conversation.message.created') return false
  return true
}

const METADATA_NOISE_KEYS = new Set([
  'scenePrompt',
  'imageGenerationPrompt',
  'imageSceneIntentPrompt',
  'requestId',
  'model',
  'styleMode',
  'toolId',
  'toolIds',
  'skillId',
  'selectedReferences',
  'sourceEventType',
  'imageAssetPath',
  'originalImageUrl',
  'conversationLinkLabel',
  'imageLinkUrl',
  'imageLinkLabel',
  'width',
  'height',
  'seed',
  'cost',
])

const cleanMetadataForNarrator = (metadata: ActivityData): ActivityData => {
  const cleaned: ActivityData = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (METADATA_NOISE_KEYS.has(key)) continue
    if (typeof value === 'string' && value.length > 400) {
      cleaned[key] = (value as string).slice(0, 400)
      continue
    }
    cleaned[key] = value
  }
  return cleaned
}

const generateStorySummary = async (
  activity: ActivityRecord,
  storySoFar: string,
  apiKey: string,
): Promise<string> => {
  const fallback = summarizeActivityFallback(activity)

  const characterName =
    readText((activity.subject as Record<string, unknown>)?.name) ||
    activity.characterId ||
    'die Figur'
  const relatedCharacterNames = readInteractionCharacterNames(activity.metadata)

  const payload = {
    model: STORY_SUMMARY_MODEL,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: [
          'Du bist ein warmherziger Kinder-Geschichtenerzaehler.',
          'Schreibe genau EINEN kurzen Erzaehlsatz in Deutsch (Vergangenheitsform), der die neue Aktivitaet als naechsten Schritt der laufenden Geschichte beschreibt.',
          `Die Hauptfigur heisst ${characterName}.`,
          '',
          'Regeln:',
          '- Erzaehlender Stil wie in einem Kinderbuch: "Agatha ruehrte geheimnisvoll in ihrem grossen Kessel."',
          '- IMMER Vergangenheitsform (Praeteritum).',
          '- Maximal 1-2 Saetze, warm und bildlich.',
          '- Keine Aufzaehlungen, kein Markdown, keine Emojis, keine Meta-Erklaerungen.',
          '- Keine technischen Begriffe (kein "Activity", kein "Prompt", kein "generiert", kein "Bild erstellt").',
          '- Wenn ein Bild erzeugt wurde: beschreibe was man in der Szene SIEHT, nicht dass ein Bild erstellt wurde.',
          relatedCharacterNames.length > 0
            ? `- Wenn diese Figuren beteiligt sind, nenne sie wenn passend beim Namen: ${relatedCharacterNames.join(', ')}.`
            : '',
          '- Orientiere dich an der bisherigen Geschichte und fuehre sie fort.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: JSON.stringify({
          instruction:
            'Fasse die NEUE Aktivitaet als naechsten Geschichten-Schritt zusammen. Nutze die bisherige Geschichte als Kontext.',
          storySoFar: storySoFar || '(Die Geschichte beginnt gerade erst.)',
          newActivity: {
            activityType: activity.activityType,
            occurredAt: activity.occurredAt,
            subject: activity.subject,
            object: activity.object,
            metadata: cleanMetadataForNarrator(activity.metadata),
            relatedCharacterNames,
          },
        }),
      },
    ],
  }

  try {
    const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      console.warn(`  OpenAI ${response.status} for ${activity.activityId}, using fallback`)
      return fallback
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = readText(body?.choices?.[0]?.message?.content)
    return content ? normalizeStorySummary(content) : fallback
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`  OpenAI error for ${activity.activityId}: ${message}, using fallback`)
    return fallback
  }
}

const loadAllCharacterIds = async (pool: Pool): Promise<string[]> => {
  const result = await pool.query<{ character_id: string }>(
    `
    SELECT DISTINCT character_id
    FROM character_activities
    WHERE character_id IS NOT NULL
    ORDER BY character_id
    `,
  )
  return result.rows.map((row) => row.character_id)
}

const loadCharacterActivities = async (
  pool: Pool,
  characterId: string,
): Promise<ActivityRow[]> => {
  const allRows: ActivityRow[] = []
  for (let page = 0; page < 200; page += 1) {
    const offset = page * MAX_LIMIT
    const result = await pool.query<ActivityRow>(
      `
      SELECT
        activity_id, activity_type, is_public, character_id,
        place_id, learning_goal_ids, skill_ids, conversation_id,
        subject, object, metadata, story_summary,
        occurred_at::text, created_at::text
      FROM character_activities
      WHERE character_id = $1
      ORDER BY occurred_at ASC, created_at ASC
      LIMIT $2 OFFSET $3
      `,
      [characterId, MAX_LIMIT, offset],
    )
    allRows.push(...result.rows)
    if (result.rows.length < MAX_LIMIT) break
  }
  return allRows
}

const run = async (): Promise<void> => {
  const isDryRun = process.argv.includes('--dry-run')
  const forceAll = process.argv.includes('--force')
  const apiKey = process.env.OPENAI_API_KEY?.trim()

  if (!apiKey) {
    console.error('OPENAI_API_KEY is required.')
    process.exitCode = 1
    return
  }

  const connectionString = process.env.DATABASE_URL?.trim() || POSTGRES_DEFAULT_URL
  const pool = new Pool({ connectionString })

  let totalScanned = 0
  let totalGenerated = 0
  let totalSkipped = 0
  let totalFailed = 0

  try {
    const characterIds = await loadAllCharacterIds(pool)
    console.log(`Found ${characterIds.length} character(s) with activities.`)

    for (const characterId of characterIds) {
      const rows = await loadCharacterActivities(pool, characterId)
      const activities = rows.map(toRecord)
      const eligible = activities.filter(shouldGenerateStorySummary)

      console.log(
        `\n[${characterId}] ${activities.length} activities total, ${eligible.length} eligible for summaries`,
      )

      const summariesSoFar: string[] = []

      for (const activity of eligible) {
        totalScanned += 1

        const alreadyHasSummary = Boolean(activity.storySummary?.trim())
        if (alreadyHasSummary && !forceAll) {
          summariesSoFar.push(activity.storySummary as string)
          totalSkipped += 1
          continue
        }

        const storySoFar = summariesSoFar.slice(-12).join('\n')
        const summary = await generateStorySummary(activity, storySoFar, apiKey)

        if (isDryRun) {
          console.log(`  [dry-run] ${activity.activityId}: ${summary}`)
        } else {
          try {
            await pool.query(
              `UPDATE character_activities SET story_summary = $2 WHERE activity_id = $1`,
              [activity.activityId, summary],
            )
            console.log(`  ${activity.activityId}: ${summary}`)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`  DB update failed for ${activity.activityId}: ${message}`)
            totalFailed += 1
            summariesSoFar.push(summary)
            continue
          }
        }

        summariesSoFar.push(summary)
        totalGenerated += 1
      }
    }

    console.log(
      JSON.stringify(
        {
          mode: isDryRun ? 'dry-run' : 'apply',
          characters: characterIds.length,
          scanned: totalScanned,
          generated: totalGenerated,
          skipped: totalSkipped,
          failed: totalFailed,
        },
        null,
        2,
      ),
    )
  } finally {
    await pool.end()
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Story summary backfill failed: ${message}`)
  process.exitCode = 1
})
