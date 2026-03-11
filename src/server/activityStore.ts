import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { getStorytimeDbPool } from './dbPool.ts'
import { getOpenAiApiKey, readServerEnv } from './openAiConfig.ts'
import {
  readCanonicalStoryText,
  readImageVisualSummaryValue,
  readSceneSummaryValue,
} from '../storyText.ts'

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const STORY_SUMMARY_MODEL = readServerEnv('RUNTIME_ACTIVITY_STORY_SUMMARY_MODEL', 'gpt-5.4')
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'

export type ActivityData = Record<string, unknown>

export type ActivityRecord = {
  activityId: string
  activityType: string
  isPublic: boolean
  characterId?: string
  placeId?: string
  learningGoalIds: string[]
  conversationId?: string
  subject: ActivityData
  object: ActivityData
  metadata: ActivityData
  storySummary?: string
  occurredAt: string
  createdAt: string
}

export type CreateActivityInput = {
  activityType: string
  isPublic?: boolean
  characterId?: string
  placeId?: string
  learningGoalIds?: string[]
  conversationId?: string
  subject?: ActivityData
  object?: ActivityData
  metadata?: ActivityData
  storySummary?: string
  occurredAt?: string
}

export type ListActivitiesInput = {
  isPublic?: boolean
  activityId?: string
  characterId?: string
  placeId?: string
  learningGoalId?: string
  conversationId?: string
  activityType?: string
  limit?: number
  offset?: number
}

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

export type ActivityChangeEvent = {
  event: 'created' | 'updated'
  activityId: string
}

let pool: Pool | null = null
let schemaEnsurePromise: Promise<void> | null = null
let listenerInitPromise: Promise<void> | null = null
const changeSubscribers = new Set<(event: ActivityChangeEvent) => void>()

const getPool = (): Pool => {
  if (pool) return pool

  pool = getStorytimeDbPool()
  return pool
}

const ensureSchemaReady = async (): Promise<void> => {
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = ensureActivityTable().then(() => undefined)
  }
  await schemaEnsurePromise
}

const normalizeData = (value: ActivityData | undefined): ActivityData =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}

const toActivityRecord = (row: ActivityRow): ActivityRecord => ({
  activityId: row.activity_id,
  activityType: row.activity_type,
  isPublic: row.is_public,
  characterId: row.character_id ?? undefined,
  placeId: row.place_id ?? undefined,
  learningGoalIds: Array.isArray(row.learning_goal_ids)
    ? row.learning_goal_ids
    : Array.isArray(row.skill_ids)
      ? row.skill_ids
      : [],
  conversationId: row.conversation_id ?? undefined,
  subject: row.subject ?? {},
  object: row.object ?? {},
  metadata: row.metadata ?? {},
  storySummary: row.story_summary ?? undefined,
  occurredAt: new Date(row.occurred_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
})

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const normalizeStorySummary = (value: string): string => {
  return value.replace(/\s+/g, ' ').trim()
}

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

const buildStoryActors = (characterName: string, relatedCharacterNames: string[]): string => {
  const others = relatedCharacterNames.filter((item) => item !== characterName)
  if (others.length === 0) return characterName
  if (others.length === 1) return `${characterName} und ${others[0]}`
  return `${characterName} und ${others.slice(0, -1).join(', ')} und ${others[others.length - 1]}`
}

const buildStoryVerb = (actors: string): string => (actors.includes(' und ') ? 'erlebten' : 'erlebte')

const buildBootstrapStoryContext = (history: ActivityRecord[], currentActivityId: string): string => {
  const steps = history
    .filter((item) => item.activityId !== currentActivityId)
    .map((item) => {
      return (
        readCanonicalStoryText({
          activityType: item.activityType,
          storySummary: item.storySummary,
          metadata: item.metadata as Record<string, unknown>,
        }) ?? ''
      )
    })
    .filter((item) => item.length > 0)
    .slice(-8)

  if (steps.length === 0) return ''
  return steps.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

const summarizeActivityFallback = (activity: ActivityRecord): string => {
  const metadata = (activity.metadata ?? {}) as Record<string, unknown>
  const canonicalMeta = readSceneSummaryValue(metadata) ?? readText(metadata.summary)

  const characterName =
    readText((activity.subject as Record<string, unknown>)?.name) ||
    activity.characterId ||
    'eine Figur'
  const relatedCharacterNames = readInteractionCharacterNames(activity.metadata)
  const actors = buildStoryActors(characterName, relatedCharacterNames)
  const verb = buildStoryVerb(actors)
  if (STORYBOOK_ACTIVITY_TYPES.has(activity.activityType)) {
    if (canonicalMeta) {
      return normalizeStorySummary(
        `Es war einmal vor langer, langer Zeit, da ${actors} Folgendes ${verb}: ${canonicalMeta}`,
      )
    }
    const visualSummary = readImageVisualSummaryValue(metadata)
    if (visualSummary) {
      return normalizeStorySummary(`Es war einmal vor langer, langer Zeit, da ${actors} Folgendes ${verb}: ${visualSummary}`)
    }
  }
  if (canonicalMeta) return normalizeStorySummary(canonicalMeta)
  return normalizeStorySummary(`Es war einmal vor langer, langer Zeit – ${actors} ${verb} etwas Neues.`)
}

const shouldGenerateStorySummary = (activity: ActivityRecord): boolean => {
  if (!activity.characterId) return false
  if (activity.activityType.startsWith('trace.')) return false
  if (activity.activityType.startsWith('tool.')) return false
  if (activity.activityType.startsWith('skill.')) return false
  if (activity.activityType.startsWith('runtime.')) return false
  if (activity.activityType === 'conversation.message.created') return false
  if (activity.activityType === 'conversation.story.summarized') return false
  return true
}

const activityTimeValue = (activity: ActivityRecord): number => {
  const occurredAt = new Date(activity.occurredAt).getTime()
  if (Number.isFinite(occurredAt)) return occurredAt
  const createdAt = new Date(activity.createdAt).getTime()
  if (Number.isFinite(createdAt)) return createdAt
  return 0
}

const loadCharacterStoryHistory = async (characterId: string): Promise<ActivityRecord[]> => {
  const items: ActivityRecord[] = []
  for (let page = 0; page < 20; page += 1) {
    const offset = page * MAX_LIMIT
    const pageItems = await listActivities({
      characterId,
      limit: MAX_LIMIT,
      offset,
    })
    items.push(...pageItems)
    if (pageItems.length < MAX_LIMIT) break
  }
  return items.sort((a, b) => activityTimeValue(a) - activityTimeValue(b))
}

const METADATA_NOISE_KEYS = new Set([
  'imagePrompt',
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

const generateStorySummaryForActivity = async (activity: ActivityRecord): Promise<string> => {
  const fallback = summarizeActivityFallback(activity)
  if (!activity.characterId) return fallback

  const history = await loadCharacterStoryHistory(activity.characterId)
  const storySoFar = history
    .filter((item) => item.activityId !== activity.activityId)
    .map((item) => readText(item.storySummary))
    .filter((item) => item.length > 0)
    .slice(-12)
    .join('\n')
  const bootstrapStorySoFar = buildBootstrapStoryContext(history, activity.activityId)
  const effectiveStoryContext = storySoFar || bootstrapStorySoFar || '(Die Geschichte beginnt gerade erst.)'

  const apiKey = getOpenAiApiKey()
  if (!apiKey) return fallback

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
          storySoFar: effectiveStoryContext,
          usedBootstrapFallback: storySoFar.length === 0 && bootstrapStorySoFar.length > 0,
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
    if (!response.ok) return fallback
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = readText(body?.choices?.[0]?.message?.content)
    return content ? normalizeStorySummary(content) : fallback
  } catch {
    return fallback
  }
}

const updateActivityStorySummary = async (
  activityId: string,
  storySummary: string,
): Promise<ActivityRecord> => {
  const db = getPool()
  const result = await db.query<ActivityRow>(
    `
    UPDATE character_activities
    SET story_summary = $2
    WHERE activity_id = $1
    RETURNING
      activity_id,
      activity_type,
      is_public,
      character_id,
      place_id,
      learning_goal_ids,
      skill_ids,
      conversation_id,
      subject,
      object,
      metadata,
      story_summary,
      occurred_at::text,
      created_at::text
    `,
    [activityId, storySummary],
  )
  return toActivityRecord(result.rows[0])
}

const parseOccurredAt = (input: string | undefined): Date => {
  if (!input) return new Date()
  const parsed = new Date(input)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('occurredAt muss ein gueltiges ISO-Datum sein.')
  }
  return parsed
}

const normalizeLimit = (value: number | undefined): number => {
  if (value == null || !Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)))
}

const normalizeOffset = (value: number | undefined): number => {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

const normalizeLearningGoalIds = (value: string[] | undefined): string[] => {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return Array.from(new Set(normalized))
}

const resolveCanonicalGameObjectId = async (
  value: string | undefined,
  expectedType: GameObjectType,
): Promise<string | null> => {
  const normalized = value?.trim()
  if (!normalized) return null
  try {
    const resolved = await gameObjectService.get(normalized)
    if (resolved?.type === expectedType) {
      return resolved.id
    }
  } catch {
    // Falls die Aufloesung fehlschlaegt, behalten wir den gelieferten Wert.
  }
  return normalized
}

const resolveLegacyCharacterIdAliases = async (value: string | undefined): Promise<string[]> => {
  const normalized = value?.trim()
  if (!normalized) return []

  const aliases = new Set<string>([normalized])
  try {
    const resolved = await gameObjectService.get(normalized)
    if (resolved?.type === 'character') {
      aliases.add(resolved.id)
      aliases.add(resolved.slug)
    }
  } catch {
    // Ohne Mapping filtern wir nur auf den gelieferten Wert.
  }
  return [...aliases]
}

const emitActivityChange = (event: ActivityChangeEvent): void => {
  for (const handler of changeSubscribers) {
    try {
      handler(event)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`Activity change subscriber failed: ${message}`)
    }
  }
}

export const createActivity = async (input: CreateActivityInput): Promise<ActivityRecord> => {
  await ensureSchemaReady()

  const activityType = input.activityType.trim()
  if (!activityType) {
    throw new Error('activityType ist erforderlich.')
  }

  const activityId = randomUUID()
  const isPublic = Boolean(input.isPublic)
  const characterId = await resolveCanonicalGameObjectId(input.characterId, 'character')
  const placeId = await resolveCanonicalGameObjectId(input.placeId, 'place')
  const learningGoalIds = await Promise.all(
    normalizeLearningGoalIds(input.learningGoalIds).map((item) =>
      resolveCanonicalGameObjectId(item, 'learning-goals'),
    ),
  ).then((items) => items.filter((item): item is string => Boolean(item)))
  const conversationId = input.conversationId?.trim() || null
  const subject = normalizeData(input.subject)
  const object = normalizeData(input.object)
  const metadata = normalizeData(input.metadata)
  const storySummary = input.storySummary ? normalizeStorySummary(input.storySummary) : null
  const occurredAt = parseOccurredAt(input.occurredAt).toISOString()

  const db = getPool()
  const result = await db.query<ActivityRow>(
    `
    INSERT INTO character_activities (
      activity_id,
      activity_type,
      is_public,
      character_id,
      place_id,
      learning_goal_ids,
      conversation_id,
      subject,
      object,
      metadata,
      story_summary,
      occurred_at
    )
    VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12::timestamptz)
    RETURNING
      activity_id,
      activity_type,
      is_public,
      character_id,
      place_id,
      learning_goal_ids,
      skill_ids,
      conversation_id,
      subject,
      object,
      metadata,
      story_summary,
      occurred_at::text,
      created_at::text
    `,
    [
      activityId,
      activityType,
      isPublic,
      characterId,
      placeId,
      learningGoalIds,
      conversationId,
      JSON.stringify(subject),
      JSON.stringify(object),
      JSON.stringify(metadata),
      storySummary,
      occurredAt,
    ],
  )

  let record = toActivityRecord(result.rows[0])
  if (!record.storySummary && shouldGenerateStorySummary(record)) {
    const storySummary = await generateStorySummaryForActivity(record)
    if (storySummary) {
      record = await updateActivityStorySummary(record.activityId, storySummary)
    }
  }
  return record
}

export const listActivities = async (input: ListActivitiesInput = {}): Promise<ActivityRecord[]> => {
  await ensureSchemaReady()

  const conditions: string[] = []
  const values: Array<string | number | boolean | string[]> = []

  const activityId = input.activityId?.trim()
  if (activityId) {
    values.push(activityId)
    conditions.push(`activity_id = $${values.length}`)
  }

  if (typeof input.isPublic === 'boolean') {
    values.push(input.isPublic)
    conditions.push(`is_public = $${values.length}`)
  }

  const characterIdAliases = await resolveLegacyCharacterIdAliases(input.characterId)
  if (characterIdAliases.length === 1) {
    values.push(characterIdAliases[0])
    conditions.push(`character_id = $${values.length}`)
  } else if (characterIdAliases.length > 1) {
    values.push(characterIdAliases)
    conditions.push(`character_id = ANY($${values.length}::text[])`)
  }

  const placeId = input.placeId?.trim()
  if (placeId) {
    values.push(placeId)
    conditions.push(`place_id = $${values.length}`)
  }

  const conversationId = input.conversationId?.trim()
  if (conversationId) {
    values.push(conversationId)
    conditions.push(`conversation_id = $${values.length}`)
  }

  const activityType = input.activityType?.trim()
  if (activityType) {
    values.push(activityType)
    conditions.push(`activity_type = $${values.length}`)
  }

  const learningGoalId = input.learningGoalId?.trim()
  if (learningGoalId) {
    values.push(learningGoalId)
    conditions.push(`$${values.length} = ANY(learning_goal_ids)`)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = normalizeLimit(input.limit)
  const offset = normalizeOffset(input.offset)
  values.push(limit)
  const limitParam = `$${values.length}`
  values.push(offset)
  const offsetParam = `$${values.length}`

  const db = getPool()
  const result = await db.query<ActivityRow>(
    `
    SELECT
      activity_id,
      activity_type,
      is_public,
      character_id,
      place_id,
      learning_goal_ids,
      skill_ids,
      conversation_id,
      subject,
      object,
      metadata,
      story_summary,
      occurred_at::text,
      created_at::text
    FROM character_activities
    ${whereClause}
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT ${limitParam}
    OFFSET ${offsetParam}
    `,
    values,
  )

  return result.rows.map((row) => toActivityRecord(row))
}

export const getActivityById = async (activityId: string): Promise<ActivityRecord | null> => {
  await ensureSchemaReady()

  const normalized = activityId.trim()
  if (!normalized) {
    throw new Error('activityId ist erforderlich.')
  }

  const data = await listActivities({ activityId: normalized, limit: 1, offset: 0 })
  return data[0] ?? null
}

const ensureActivityListener = async (): Promise<void> => {
  if (!listenerInitPromise) {
    listenerInitPromise = (async () => {
      await ensureSchemaReady()
      const db = getPool()
      const listener = await db.connect()
      listener.on('notification', (notification) => {
        if (!notification.payload) return
        try {
          const payload = JSON.parse(notification.payload) as ActivityChangeEvent
          if (
            payload &&
            (payload.event === 'created' || payload.event === 'updated') &&
            typeof payload.activityId === 'string'
          ) {
            emitActivityChange(payload)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`Activity notification parse failed: ${message}`)
        }
      })
      listener.on('error', (error) => {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`Activity listener error: ${message}`)
      })
      await listener.query('LISTEN character_activities_changes')
    })()
  }

  await listenerInitPromise
}

export const subscribeToActivityChanges = async (
  handler: (event: ActivityChangeEvent) => void,
): Promise<() => void> => {
  await ensureActivityListener()
  changeSubscribers.add(handler)
  return () => {
    changeSubscribers.delete(handler)
  }
}

// ---------------------------------------------------------------------------
// UUID-enriched activity API via gameObjectService
// ---------------------------------------------------------------------------

import * as gameObjectService from './gameObjectService.ts'
import type { GameObjectType } from '../content/types.ts'

export type ActivityObjectContext = {
  id: string
  name: string
  type: GameObjectType
  slug: string
}

export type EnrichedActivityRecord = ActivityRecord & {
  characterContext?: ActivityObjectContext
  placeContext?: ActivityObjectContext
  learningGoalContexts: ActivityObjectContext[]
}

export const enrichActivity = async (
  activity: ActivityRecord,
): Promise<EnrichedActivityRecord> => {
  const idsToResolve = new Set<string>()
  if (activity.characterId) idsToResolve.add(activity.characterId)
  if (activity.placeId) idsToResolve.add(activity.placeId)
  for (const goalId of activity.learningGoalIds) {
    idsToResolve.add(goalId)
  }

  const contexts = await gameObjectService.getContextBatch(Array.from(idsToResolve))
  const contextMap = new Map(contexts.map((ctx) => [ctx.id, ctx]))

  return {
    ...activity,
    characterContext: activity.characterId ? contextMap.get(activity.characterId) ?? undefined : undefined,
    placeContext: activity.placeId ? contextMap.get(activity.placeId) ?? undefined : undefined,
    learningGoalContexts: activity.learningGoalIds
      .map((id) => contextMap.get(id))
      .filter((ctx): ctx is ActivityObjectContext => ctx !== undefined),
  }
}

export const listActivitiesWithContext = async (
  input: ListActivitiesInput = {},
): Promise<EnrichedActivityRecord[]> => {
  const activities = await listActivities(input)
  return Promise.all(activities.map(enrichActivity))
}

export const ensureActivityTable = async (): Promise<{ tableName: string; created: boolean }> => {
  const db = getPool()
  const existsResult = await db.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'character_activities'
    ) AS "exists"
    `,
  )
  const existedBefore = Boolean(existsResult.rows[0]?.exists)

  await db.query(`
    CREATE TABLE IF NOT EXISTS character_activities (
      activity_id TEXT PRIMARY KEY,
      activity_type TEXT NOT NULL,
      is_public BOOLEAN NOT NULL DEFAULT FALSE,
      character_id TEXT,
      place_id TEXT,
      learning_goal_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
      skill_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
      conversation_id TEXT,
      subject JSONB NOT NULL DEFAULT '{}'::jsonb,
      object JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      story_summary TEXT,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_character_activities_character_id
      ON character_activities (character_id);

    CREATE INDEX IF NOT EXISTS idx_character_activities_conversation_id
      ON character_activities (conversation_id);

    ALTER TABLE character_activities
      ADD COLUMN IF NOT EXISTS place_id TEXT;

    ALTER TABLE character_activities
      ADD COLUMN IF NOT EXISTS learning_goal_ids TEXT[] NOT NULL DEFAULT '{}'::text[];

    ALTER TABLE character_activities
      ADD COLUMN IF NOT EXISTS skill_ids TEXT[] NOT NULL DEFAULT '{}'::text[];

    ALTER TABLE character_activities
      ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

    ALTER TABLE character_activities
      ADD COLUMN IF NOT EXISTS story_summary TEXT;

    UPDATE character_activities
    SET learning_goal_ids = skill_ids
    WHERE cardinality(learning_goal_ids) = 0
      AND cardinality(skill_ids) > 0;

    CREATE INDEX IF NOT EXISTS idx_character_activities_place_id
      ON character_activities (place_id);

    CREATE INDEX IF NOT EXISTS idx_character_activities_type
      ON character_activities (activity_type);

    CREATE INDEX IF NOT EXISTS idx_character_activities_is_public
      ON character_activities (is_public);

    CREATE INDEX IF NOT EXISTS idx_character_activities_occurred_at
      ON character_activities (occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_character_activities_learning_goal_ids
      ON character_activities USING GIN (learning_goal_ids);

    CREATE OR REPLACE FUNCTION notify_character_activity_change()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        PERFORM pg_notify(
          'character_activities_changes',
          json_build_object(
            'event', 'created',
            'activityId', NEW.activity_id
          )::text
        );
      ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.story_summary IS DISTINCT FROM OLD.story_summary THEN
          PERFORM pg_notify(
            'character_activities_changes',
            json_build_object(
              'event', 'updated',
              'activityId', NEW.activity_id
            )::text
          );
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER IF EXISTS trg_character_activities_notify_insert ON character_activities;
    DROP TRIGGER IF EXISTS trg_character_activities_notify_update ON character_activities;

    CREATE TRIGGER trg_character_activities_notify_insert
    AFTER INSERT ON character_activities
    FOR EACH ROW
    EXECUTE FUNCTION notify_character_activity_change();

    CREATE TRIGGER trg_character_activities_notify_update
    AFTER UPDATE ON character_activities
    FOR EACH ROW
    WHEN (OLD.story_summary IS DISTINCT FROM NEW.story_summary)
    EXECUTE FUNCTION notify_character_activity_change();
  `)

  return { tableName: 'character_activities', created: !existedBefore }
}
