import { Pool } from 'pg'
import { getStorytimeDbPool } from './dbPool.ts'

const RELATIONSHIP_ID_SEPARATOR = '#'

export type CharacterRelationshipDirection = 'outgoing' | 'incoming'

export type CharacterRelationshipMetadata = Record<string, unknown>

export type CharacterRelatedObject = {
  type: string
  id: string
  label?: string
  metadata?: Record<string, unknown>
}

export type CharacterRelationshipRecord = {
  relationshipId: string
  sourceCharacterId: string
  targetCharacterId: string
  relationshipType: string
  relationshipTypeReadable: string
  relationship: string
  description?: string
  metadata?: CharacterRelationshipMetadata
  otherRelatedObjects: CharacterRelatedObject[]
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
  otherRelatedObjects?: CharacterRelatedObject[]
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
  other_related_objects: CharacterRelatedObject[] | null
  created_at: string
  updated_at: string
}

type CharacterRelationshipWithDirectionRow = CharacterRelationshipRow & {
  direction: CharacterRelationshipDirection
}

const getPool = (): Pool => {
  if (pool) return pool

  pool = getStorytimeDbPool()

  return pool
}

const ensureSchemaReady = async (): Promise<void> => {
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = ensureCharacterRelationshipTable()
      .then(() => undefined)
      .catch((error) => {
        schemaEnsurePromise = null
        throw error
      })
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
  relationshipTypeReadable: toStandardRelationshipLabel(row.relationship_type),
  relationship: toStandardRelationshipLabel(row.relationship_type),
  description: row.description ?? undefined,
  metadata: row.metadata ?? undefined,
  otherRelatedObjects: Array.isArray(row.other_related_objects) ? row.other_related_objects : [],
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
})

const normalizeOtherRelatedObjects = (items: CharacterRelatedObject[] | undefined): CharacterRelatedObject[] => {
  if (!Array.isArray(items)) return []

  const uniqueByTypeAndId = new Map<string, CharacterRelatedObject>()
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const type = typeof item.type === 'string' ? item.type.trim() : ''
    const id = typeof item.id === 'string' ? item.id.trim() : ''
    if (!type || !id) continue
    const label = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : undefined
    const metadata =
      item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
        ? item.metadata
        : undefined
    uniqueByTypeAndId.set(`${type.toLowerCase()}#${id.toLowerCase()}`, {
      type,
      id,
      label,
      metadata,
    })
  }

  return Array.from(uniqueByTypeAndId.values())
}

const slugifyRelationshipType = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const humanizeRelationshipType = (value: string): string =>
  value
    .split('_')
    .filter(Boolean)
    .join(' ')
    .trim()

const STANDARD_RELATIONSHIP_LABELS: Record<string, string> = {
  beste_freundin: 'Beste Freundin',
  gute_freundin: 'Gute Freundin',
  schwester: 'Schwester',
  bruder: 'Bruder',
  geschwister: 'Geschwister',
  bezugsmensch: 'Bezugsmensch',
  spielgefaehrtin: 'Spielgefaehrtin',
  huendin: 'Huendin',
  vorbild: 'Vorbild',
  feind: 'Feind',
  fuerchtet_sich_vor: 'Hat Angst vor',
}

const toStandardRelationshipLabel = (relationshipType: string): string => {
  const normalizedType = relationshipType.trim().toLowerCase()
  const explicitLabel = STANDARD_RELATIONSHIP_LABELS[normalizedType]
  if (explicitLabel) return explicitLabel

  const humanized = humanizeRelationshipType(normalizedType)
  if (!humanized) return ''
  return humanized
    .split(' ')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

const deriveSemanticRelationshipType = (rawValues: string[]): string => {
  const normalizedValues = rawValues
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)

  if (
    normalizedValues.some((value) => value.includes('beste') && value.includes('freund'))
  ) {
    return 'beste_freundin'
  }
  if (
    normalizedValues.some((value) => value.includes('gute') && value.includes('freund'))
  ) {
    return 'gute_freundin'
  }
  if (normalizedValues.some((value) => value.includes('schwester'))) {
    return 'schwester'
  }
  if (normalizedValues.some((value) => value.includes('bruder'))) {
    return 'bruder'
  }
  if (normalizedValues.some((value) => value.includes('geschwister'))) {
    return 'geschwister'
  }
  if (
    normalizedValues.some(
      (value) =>
        value.includes('furcht') ||
        value.includes('fuercht') ||
        (value.includes('angst') && value.includes('vor')),
    )
  ) {
    return 'fuerchtet_sich_vor'
  }

  const explicitType = slugifyRelationshipType(rawValues[0] ?? '')
  if (explicitType) return explicitType

  for (const value of rawValues.slice(1)) {
    const fallbackType = slugifyRelationshipType(value)
    if (fallbackType) return fallbackType
  }

  return ''
}

const normalizeInput = (input: UpsertCharacterRelationshipInput): UpsertCharacterRelationshipInput => {
  const sourceCharacterId = input.sourceCharacterId.trim()
  const targetCharacterId = input.targetCharacterId.trim()
  const rawRelationshipType = input.relationshipType.trim()
  const rawRelationshipTypeReadable = input.relationshipTypeReadable?.trim() ?? ''
  const rawRelationship = input.relationship.trim()
  const relationshipType = deriveSemanticRelationshipType([
    rawRelationshipType,
    rawRelationshipTypeReadable,
    rawRelationship,
  ])
  const standardizedLabel = toStandardRelationshipLabel(relationshipType)
  const relationship = standardizedLabel || rawRelationship || rawRelationshipTypeReadable
  const relationshipTypeReadable = standardizedLabel || rawRelationshipTypeReadable || relationship

  return {
    sourceCharacterId,
    targetCharacterId,
    relationshipType,
    relationshipTypeReadable,
    relationship,
    description: input.description?.trim(),
    metadata: input.metadata,
    otherRelatedObjects: normalizeOtherRelatedObjects(input.otherRelatedObjects),
  }
}

const validateInput = (input: UpsertCharacterRelationshipInput): void => {
  if (!input.sourceCharacterId) {
    throw new Error('sourceCharacterId ist erforderlich.')
  }
  if (!input.targetCharacterId) {
    throw new Error('targetCharacterId ist erforderlich.')
  }
  if (!input.relationshipType) {
    throw new Error('relationshipType, relationshipTypeReadable oder relationship ist erforderlich.')
  }
  if (!input.relationship) {
    throw new Error('relationshipTypeReadable oder relationship ist erforderlich.')
  }
}

const resolveCanonicalGameObjectId = async (value: string): Promise<string> => {
  const normalized = value.trim()
  if (!normalized) return ''
  try {
    const resolved = await gameObjectService.get(normalized)
    return resolved?.id ?? normalized
  } catch {
    return normalized
  }
}

const resolveCanonicalRelationshipRecord = async (
  record: CharacterRelationshipRecord,
): Promise<CharacterRelationshipRecord> => {
  const [sourceCharacterId, targetCharacterId] = await Promise.all([
    resolveCanonicalGameObjectId(record.sourceCharacterId),
    resolveCanonicalGameObjectId(record.targetCharacterId),
  ])

  return {
    ...record,
    sourceCharacterId,
    targetCharacterId,
  }
}

export const upsertCharacterRelationship = async (
  payload: UpsertCharacterRelationshipInput,
): Promise<CharacterRelationshipRecord> => {
  await ensureSchemaReady()

  const input = normalizeInput({
    ...payload,
    sourceCharacterId: await resolveCanonicalGameObjectId(payload.sourceCharacterId),
    targetCharacterId: await resolveCanonicalGameObjectId(payload.targetCharacterId),
  })
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
      metadata,
      other_related_objects
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb)
    ON CONFLICT (relationship_id)
    DO UPDATE SET
      source_character_id = EXCLUDED.source_character_id,
      target_character_id = EXCLUDED.target_character_id,
      relationship_type = EXCLUDED.relationship_type,
      relationship_type_readable = EXCLUDED.relationship_type_readable,
      relationship = EXCLUDED.relationship,
      description = EXCLUDED.description,
      metadata = EXCLUDED.metadata,
      other_related_objects = EXCLUDED.other_related_objects,
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
      other_related_objects,
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
      JSON.stringify(input.otherRelatedObjects ?? []),
    ],
  )

  return resolveCanonicalRelationshipRecord(mapRowToRelationshipRecord(result.rows[0]))
}

export const listRelationshipsForCharacter = async (
  characterId: string,
): Promise<ListRelationshipsForCharacterResult> => {
  await ensureSchemaReady()

  const normalizedCharacterId = await resolveCanonicalGameObjectId(characterId)
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
      other_related_objects,
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
      other_related_objects,
      created_at::text,
      updated_at::text,
      'incoming'::text AS direction
    FROM character_relationships
    WHERE target_character_id = $1

    ORDER BY updated_at DESC
    `,
    [normalizedCharacterId],
  )

  const dedupedByCounterpart = new Map<string, CharacterRelationshipWithDirectionRow>()

  for (const row of data.rows) {
    const counterpartId =
      row.source_character_id === normalizedCharacterId
        ? row.target_character_id
        : row.source_character_id
    const existing = dedupedByCounterpart.get(counterpartId)

    if (!existing) {
      dedupedByCounterpart.set(counterpartId, row)
      continue
    }

    // Prefer an outgoing relationship for display when both directions exist.
    if (existing.direction === 'incoming' && row.direction === 'outgoing') {
      dedupedByCounterpart.set(counterpartId, row)
    }
  }

  return Promise.all(
    Array.from(dedupedByCounterpart.values()).map(async (row) => ({
      ...(await resolveCanonicalRelationshipRecord(mapRowToRelationshipRecord(row))),
      direction: row.direction,
    })),
  )
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
      other_related_objects,
      created_at::text,
      updated_at::text
    FROM character_relationships
    ORDER BY updated_at DESC
    `,
  )

  return Promise.all(data.rows.map((row) => resolveCanonicalRelationshipRecord(mapRowToRelationshipRecord(row))))
}

export type RelationshipByRelatedObjectRecord = {
  relationship: CharacterRelationshipRecord
  matchedObject: CharacterRelatedObject
}

export const listRelationshipsByOtherRelatedObject = async (
  type: string,
  id: string,
): Promise<RelationshipByRelatedObjectRecord[]> => {
  await ensureSchemaReady()

  const normalizedType = type.trim()
  const normalizedId = id.trim()
  if (!normalizedType) {
    throw new Error('type ist erforderlich.')
  }
  if (!normalizedId) {
    throw new Error('id ist erforderlich.')
  }

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
      other_related_objects,
      created_at::text,
      updated_at::text
    FROM character_relationships
    WHERE other_related_objects @> $1::jsonb
    ORDER BY updated_at DESC
    `,
    [JSON.stringify([{ type: normalizedType, id: normalizedId }])],
  )

  return data.rows
    .map((row) => {
      const relationship = row
      const matchedObject =
        (Array.isArray(relationship.other_related_objects) ? relationship.other_related_objects : []).find(
          (item) =>
            item.type.toLowerCase() === normalizedType.toLowerCase() &&
            item.id.toLowerCase() === normalizedId.toLowerCase(),
        ) ?? null
      if (!matchedObject) return null
      return { relationship: mapRowToRelationshipRecord(row), matchedObject }
    })
    .filter((item): item is RelationshipByRelatedObjectRecord => item !== null)
    .map(async (item) => ({
      relationship: await resolveCanonicalRelationshipRecord(item.relationship),
      matchedObject: item.matchedObject,
    }))
    .reduce<Promise<RelationshipByRelatedObjectRecord[]>>(async (accPromise, itemPromise) => {
      const acc = await accPromise
      acc.push(await itemPromise)
      return acc
    }, Promise.resolve([]))
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
      other_related_objects JSONB NOT NULL DEFAULT '[]'::jsonb,
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

    ALTER TABLE character_relationships
      ADD COLUMN IF NOT EXISTS other_related_objects JSONB NOT NULL DEFAULT '[]'::jsonb;

    UPDATE character_relationships
    SET relationship_type_readable = relationship
    WHERE relationship_type_readable IS NULL OR relationship_type_readable = '';

    UPDATE character_relationships
    SET other_related_objects = '[]'::jsonb
    WHERE other_related_objects IS NULL;

    CREATE INDEX IF NOT EXISTS idx_character_relationships_other_related_objects
      ON character_relationships USING GIN (other_related_objects);
  `)

  return { tableName: 'character_relationships', created: !existedBefore }
}

// ---------------------------------------------------------------------------
// Generalized UUID-based object relationship API
// The underlying DB columns are named source_character_id / target_character_id
// but they now store UUIDs of any game object type.
// ---------------------------------------------------------------------------

import * as gameObjectService from './gameObjectService.ts'
import type { GameObjectType } from '../content/types.ts'

export type ObjectRelationshipContext = {
  relationshipId: string
  source: { id: string; name: string; type: GameObjectType; slug: string }
  target: { id: string; name: string; type: GameObjectType; slug: string }
  relationshipType: string
  relationshipTypeReadable: string
  relationship: string
  description?: string
  otherRelatedObjects: CharacterRelatedObject[]
  direction: CharacterRelationshipDirection
}

export const listRelationshipsForObject = async (
  objectId: string,
): Promise<ObjectRelationshipContext[]> => {
  const records = await listRelationshipsForCharacter(objectId)

  const allIds = new Set<string>()
  for (const record of records) {
    allIds.add(record.sourceCharacterId)
    allIds.add(record.targetCharacterId)
  }

  const contextMap = new Map<string, { id: string; name: string; type: GameObjectType; slug: string }>()
  const contexts = await gameObjectService.getContextBatch(Array.from(allIds))
  for (const ctx of contexts) {
    contextMap.set(ctx.id, ctx)
  }

  const fallbackContext = (id: string) =>
    contextMap.get(id) ?? { id, name: id, type: 'character' as GameObjectType, slug: id }

  return records.map((record) => ({
    relationshipId: record.relationshipId,
    source: fallbackContext(record.sourceCharacterId),
    target: fallbackContext(record.targetCharacterId),
    relationshipType: record.relationshipType,
    relationshipTypeReadable: record.relationshipTypeReadable,
    relationship: record.relationship,
    description: record.description,
    otherRelatedObjects: record.otherRelatedObjects,
    direction: record.direction,
  }))
}
