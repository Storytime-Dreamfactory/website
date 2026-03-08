import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'

const POSTGRES_DEFAULT_URL = 'postgres://storytime:storytime@localhost:5433/storytime'
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

export type ActivityData = Record<string, unknown>

export type ActivityRecord = {
  activityId: string
  activityType: string
  isPublic: boolean
  characterId?: string
  placeId?: string
  skillIds: string[]
  conversationId?: string
  subject: ActivityData
  object: ActivityData
  metadata: ActivityData
  occurredAt: string
  createdAt: string
}

export type CreateActivityInput = {
  activityType: string
  isPublic?: boolean
  characterId?: string
  placeId?: string
  skillIds?: string[]
  conversationId?: string
  subject?: ActivityData
  object?: ActivityData
  metadata?: ActivityData
  occurredAt?: string
}

export type ListActivitiesInput = {
  isPublic?: boolean
  characterId?: string
  placeId?: string
  skillId?: string
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
  skill_ids: string[] | null
  conversation_id: string | null
  subject: ActivityData | null
  object: ActivityData | null
  metadata: ActivityData | null
  occurred_at: string
  created_at: string
}

let pool: Pool | null = null
let schemaEnsurePromise: Promise<void> | null = null

const getPool = (): Pool => {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL?.trim() || POSTGRES_DEFAULT_URL
  pool = new Pool({ connectionString })
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
  skillIds: Array.isArray(row.skill_ids) ? row.skill_ids : [],
  conversationId: row.conversation_id ?? undefined,
  subject: row.subject ?? {},
  object: row.object ?? {},
  metadata: row.metadata ?? {},
  occurredAt: new Date(row.occurred_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
})

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

const normalizeSkillIds = (value: string[] | undefined): string[] => {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return Array.from(new Set(normalized))
}

export const createActivity = async (input: CreateActivityInput): Promise<ActivityRecord> => {
  await ensureSchemaReady()

  const activityType = input.activityType.trim()
  if (!activityType) {
    throw new Error('activityType ist erforderlich.')
  }

  const activityId = randomUUID()
  const isPublic = Boolean(input.isPublic)
  const characterId = input.characterId?.trim() || null
  const placeId = input.placeId?.trim() || null
  const skillIds = normalizeSkillIds(input.skillIds)
  const conversationId = input.conversationId?.trim() || null
  const subject = normalizeData(input.subject)
  const object = normalizeData(input.object)
  const metadata = normalizeData(input.metadata)
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
      skill_ids,
      conversation_id,
      subject,
      object,
      metadata,
      occurred_at
    )
    VALUES ($1, $2, $3, $4, $5, $6::text[], $7, $8::jsonb, $9::jsonb, $10::jsonb, $11::timestamptz)
    RETURNING
      activity_id,
      activity_type,
      is_public,
      character_id,
      place_id,
      skill_ids,
      conversation_id,
      subject,
      object,
      metadata,
      occurred_at::text,
      created_at::text
    `,
    [
      activityId,
      activityType,
      isPublic,
      characterId,
      placeId,
      skillIds,
      conversationId,
      JSON.stringify(subject),
      JSON.stringify(object),
      JSON.stringify(metadata),
      occurredAt,
    ],
  )

  return toActivityRecord(result.rows[0])
}

export const listActivities = async (input: ListActivitiesInput = {}): Promise<ActivityRecord[]> => {
  await ensureSchemaReady()

  const conditions: string[] = []
  const values: Array<string | number | boolean> = []

  if (typeof input.isPublic === 'boolean') {
    values.push(input.isPublic)
    conditions.push(`is_public = $${values.length}`)
  }

  const characterId = input.characterId?.trim()
  if (characterId) {
    values.push(characterId)
    conditions.push(`character_id = $${values.length}`)
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

  const skillId = input.skillId?.trim()
  if (skillId) {
    values.push(skillId)
    conditions.push(`$${values.length} = ANY(skill_ids)`)
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
      skill_ids,
      conversation_id,
      subject,
      object,
      metadata,
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
      skill_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
      conversation_id TEXT,
      subject JSONB NOT NULL DEFAULT '{}'::jsonb,
      object JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
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
      ADD COLUMN IF NOT EXISTS skill_ids TEXT[] NOT NULL DEFAULT '{}'::text[];

    ALTER TABLE character_activities
      ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE INDEX IF NOT EXISTS idx_character_activities_place_id
      ON character_activities (place_id);

    CREATE INDEX IF NOT EXISTS idx_character_activities_type
      ON character_activities (activity_type);

    CREATE INDEX IF NOT EXISTS idx_character_activities_is_public
      ON character_activities (is_public);

    CREATE INDEX IF NOT EXISTS idx_character_activities_occurred_at
      ON character_activities (occurred_at DESC);

    CREATE INDEX IF NOT EXISTS idx_character_activities_skill_ids
      ON character_activities USING GIN (skill_ids);
  `)

  return { tableName: 'character_activities', created: !existedBefore }
}
