import { Pool } from 'pg'

const RELATIONSHIP_ID_SEPARATOR = '#'
const POSTGRES_DEFAULT_URL = 'postgres://storytime:storytime@localhost:5433/storytime'

export type CharacterRelationshipDirection = 'outgoing' | 'incoming'

export type CharacterRelationshipMetadata = Record<string, unknown>

export type CharacterRelationshipRecord = {
  relationshipId: string
  sourceCharacterId: string
  targetCharacterId: string
  relationshipType: string
  relationshipTypeReadable: string
  relationship: string
  description?: string
  metadata?: CharacterRelationshipMetadata
  createdAt: string
  updatedAt: string
}

export type UpsertCharacterRelationshipInput = {
  sourceCharacterId: string
  targetCharacterId: string
  relationshipType: string
  relationshipTypeReadable?: string
  relationship: string
  description?: string
  metadata?: CharacterRelationshipMetadata
}

type ListRelationshipsForCharacterResult = Array<
  CharacterRelationshipRecord & { direction: CharacterRelationshipDirection }
>

let pool: Pool | null = null
let schemaEnsurePromise: Promise<void> | null = null

type CharacterRelationshipRow = {
  relationship_id: string
  source_character_id: string
  target_character_id: string
  relationship_type: string
  relationship_type_readable: string | null
  relationship: string
  description: string | null
  metadata: CharacterRelationshipMetadata | null
  created_at: string
  updated_at: string
}

type CharacterRelationshipWithDirectionRow = CharacterRelationshipRow & {
  direction: CharacterRelationshipDirection
}

const getPool = (): Pool => {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL?.trim() || POSTGRES_DEFAULT_URL

  pool = new Pool({
    connectionString,
  })

  return pool
}

const ensureSchemaReady = async (): Promise<void> => {
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = ensureCharacterRelationshipTable().then(() => undefined)
  }
  await schemaEnsurePromise
}

const toRelationshipId = (
  sourceCharacterId: string,
  targetCharacterId: string,
  relationshipType: string,
): string =>
  [sourceCharacterId.trim(), targetCharacterId.trim(), relationshipType.trim()]
    .map((item) => item.toLowerCase())
    .join(RELATIONSHIP_ID_SEPARATOR)

const mapRowToRelationshipRecord = (
  row: CharacterRelationshipRow | CharacterRelationshipWithDirectionRow,
): CharacterRelationshipRecord => ({
  relationshipId: row.relationship_id,
  sourceCharacterId: row.source_character_id,
  targetCharacterId: row.target_character_id,
  relationshipType: row.relationship_type,
  relationshipTypeReadable: row.relationship_type_readable ?? row.relationship_type,
  relationship: row.relationship,
  description: row.description ?? undefined,
  metadata: row.metadata ?? undefined,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
})

const normalizeInput = (input: UpsertCharacterRelationshipInput): UpsertCharacterRelationshipInput => ({
  sourceCharacterId: input.sourceCharacterId.trim(),
  targetCharacterId: input.targetCharacterId.trim(),
  relationshipType: input.relationshipType.trim(),
  relationshipTypeReadable: input.relationshipTypeReadable?.trim(),
  relationship: input.relationship.trim(),
  description: input.description?.trim(),
  metadata: input.metadata,
})

const validateInput = (input: UpsertCharacterRelationshipInput): void => {
  if (!input.sourceCharacterId) {
    throw new Error('sourceCharacterId ist erforderlich.')
  }
  if (!input.targetCharacterId) {
    throw new Error('targetCharacterId ist erforderlich.')
  }
  if (!input.relationshipType) {
    throw new Error('relationshipType ist erforderlich.')
  }
  if (!input.relationship) {
    throw new Error('relationship ist erforderlich.')
  }
}

export const upsertCharacterRelationship = async (
  payload: UpsertCharacterRelationshipInput,
): Promise<CharacterRelationshipRecord> => {
  await ensureSchemaReady()

  const input = normalizeInput(payload)
  validateInput(input)

  const relationshipId = toRelationshipId(
    input.sourceCharacterId,
    input.targetCharacterId,
    input.relationshipType,
  )
  const relationshipTypeReadable =
    input.relationshipTypeReadable && input.relationshipTypeReadable.length > 0
      ? input.relationshipTypeReadable
      : input.relationship

  const db = getPool()
  const result = await db.query<CharacterRelationshipRow>(
    `
    INSERT INTO character_relationships (
      relationship_id,
      source_character_id,
      target_character_id,
      relationship_type,
      relationship_type_readable,
      relationship,
      description,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    ON CONFLICT (relationship_id)
    DO UPDATE SET
      source_character_id = EXCLUDED.source_character_id,
      target_character_id = EXCLUDED.target_character_id,
      relationship_type = EXCLUDED.relationship_type,
      relationship_type_readable = EXCLUDED.relationship_type_readable,
      relationship = EXCLUDED.relationship,
      description = EXCLUDED.description,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
    RETURNING
      relationship_id,
      source_character_id,
      target_character_id,
      relationship_type,
      relationship_type_readable,
      relationship,
      description,
      metadata,
      created_at::text,
      updated_at::text
    `,
    [
      relationshipId,
      input.sourceCharacterId,
      input.targetCharacterId,
      input.relationshipType,
      relationshipTypeReadable,
      input.relationship,
      input.description ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  )

  return mapRowToRelationshipRecord(result.rows[0])
}

export const listRelationshipsForCharacter = async (
  characterId: string,
): Promise<ListRelationshipsForCharacterResult> => {
  await ensureSchemaReady()

  const normalizedCharacterId = characterId.trim()
  if (!normalizedCharacterId) {
    throw new Error('characterId ist erforderlich.')
  }

  const db = getPool()
  const data = await db.query<CharacterRelationshipWithDirectionRow>(
    `
    SELECT
      relationship_id,
      source_character_id,
      target_character_id,
      relationship_type,
      relationship_type_readable,
      relationship,
      description,
      metadata,
      created_at::text,
      updated_at::text,
      'outgoing'::text AS direction
    FROM character_relationships
    WHERE source_character_id = $1

    UNION ALL

    SELECT
      relationship_id,
      source_character_id,
      target_character_id,
      relationship_type,
      relationship_type_readable,
      relationship,
      description,
      metadata,
      created_at::text,
      updated_at::text,
      'incoming'::text AS direction
    FROM character_relationships
    WHERE target_character_id = $1

    ORDER BY updated_at DESC
    `,
    [normalizedCharacterId],
  )

  return data.rows.map((row) => ({
    ...mapRowToRelationshipRecord(row),
    direction: row.direction,
  }))
}

export const listAllRelationships = async (): Promise<CharacterRelationshipRecord[]> => {
  await ensureSchemaReady()

  const db = getPool()
  const data = await db.query<CharacterRelationshipRow>(
    `
    SELECT
      relationship_id,
      source_character_id,
      target_character_id,
      relationship_type,
      relationship_type_readable,
      relationship,
      description,
      metadata,
      created_at::text,
      updated_at::text
    FROM character_relationships
    ORDER BY updated_at DESC
    `,
  )

  return data.rows.map((row) => mapRowToRelationshipRecord(row))
}

export const ensureCharacterRelationshipTable = async (
  _options: Record<string, never> = {},
): Promise<{ tableName: string; created: boolean }> => {
  const db = getPool()
  const existsResult = await db.query<{ exists: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'character_relationships'
    ) AS "exists"
    `,
  )
  const existedBefore = Boolean(existsResult.rows[0]?.exists)

  await db.query(`
    CREATE TABLE IF NOT EXISTS character_relationships (
      relationship_id TEXT PRIMARY KEY,
      source_character_id TEXT NOT NULL,
      target_character_id TEXT NOT NULL,
      relationship_type TEXT NOT NULL,
      relationship_type_readable TEXT,
      relationship TEXT NOT NULL,
      description TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_character_relationships_source
      ON character_relationships (source_character_id);

    CREATE INDEX IF NOT EXISTS idx_character_relationships_target
      ON character_relationships (target_character_id);

    CREATE INDEX IF NOT EXISTS idx_character_relationships_type
      ON character_relationships (relationship_type);

    ALTER TABLE character_relationships
      ADD COLUMN IF NOT EXISTS relationship_type_readable TEXT;

    UPDATE character_relationships
    SET relationship_type_readable = relationship
    WHERE relationship_type_readable IS NULL OR relationship_type_readable = '';
  `)

  return { tableName: 'character_relationships', created: !existedBefore }
}
