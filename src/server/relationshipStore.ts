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
  fromTitle: string
  toTitle: string
  relationshipTypeReadable: string
  relationship: string
  description?: string
  properties?: CharacterRelationshipMetadata
  /** @deprecated Use properties instead. Kept for backward compatibility. */
  metadata?: CharacterRelationshipMetadata
  otherRelatedObjects: CharacterRelatedObject[]
  createdAt: string
  updatedAt: string
}

export type UpsertCharacterRelationshipInput = {
  sourceCharacterId: string
  targetCharacterId: string
  relationshipType: string
  fromTitle?: string
  toTitle?: string
  relationshipTypeReadable?: string
  relationship: string
  description?: string
  properties?: CharacterRelationshipMetadata
  /** @deprecated Use properties instead. Kept for backward compatibility. */
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
  from_title: string | null
  to_title: string | null
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
): CharacterRelationshipRecord => {
  const titlePair = resolveTitlePair(row.relationship_type)
  const fallbackTitle = row.relationship_type_readable?.trim() || row.relationship?.trim() || ''
  const fromTitle = row.from_title?.trim() || titlePair.fromTitle || fallbackTitle
  const toTitle = row.to_title?.trim() || titlePair.toTitle || fromTitle
  const resolvedLabel =
    'direction' in row && row.direction === 'incoming'
      ? toTitle || fromTitle
      : fromTitle || toTitle
  const properties = row.metadata ?? undefined

  return {
    relationshipId: row.relationship_id,
    sourceCharacterId: row.source_character_id,
    targetCharacterId: row.target_character_id,
    relationshipType: row.relationship_type,
    fromTitle,
    toTitle,
    relationshipTypeReadable: resolvedLabel,
    relationship: resolvedLabel,
    description: row.description ?? undefined,
    properties,
    metadata: properties,
    otherRelatedObjects: Array.isArray(row.other_related_objects) ? row.other_related_objects : [],
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

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

type RelationshipTypeDefinition = {
  type: string
  fromTitle: string
  toTitle: string
}

const RELATIONSHIP_TYPE_DEFINITIONS: RelationshipTypeDefinition[] = [
  { type: 'mother_of', fromTitle: 'Mutter', toTitle: 'Kind' },
  { type: 'father_of', fromTitle: 'Vater', toTitle: 'Kind' },
  { type: 'parent_of', fromTitle: 'Elternteil', toTitle: 'Kind' },
  { type: 'child_of', fromTitle: 'Kind', toTitle: 'Elternteil' },
  { type: 'sibling_of', fromTitle: 'Geschwister', toTitle: 'Geschwister' },
  { type: 'cousin_of', fromTitle: 'Cousine/Cousin', toTitle: 'Cousine/Cousin' },
  { type: 'grandparent_of', fromTitle: 'Grosselternteil', toTitle: 'Enkelkind' },
  { type: 'grandchild_of', fromTitle: 'Enkelkind', toTitle: 'Grosselternteil' },
  { type: 'guardian_of', fromTitle: 'Bezugsperson', toTitle: 'Schuetzling' },
  { type: 'ward_of', fromTitle: 'Schuetzling', toTitle: 'Bezugsperson' },
  { type: 'friend_of', fromTitle: 'Freundschaft', toTitle: 'Freundschaft' },
  { type: 'best_friend_of', fromTitle: 'Beste Freundschaft', toTitle: 'Beste Freundschaft' },
  { type: 'ally_of', fromTitle: 'Verbuendet', toTitle: 'Verbuendet' },
  { type: 'mentor_of', fromTitle: 'Mentor', toTitle: 'Schueler' },
  { type: 'student_of', fromTitle: 'Schueler', toTitle: 'Mentor' },
  { type: 'rival_of', fromTitle: 'Rivale', toTitle: 'Rivale' },
  { type: 'enemy_of', fromTitle: 'Feind', toTitle: 'Feind' },
  { type: 'fears', fromTitle: 'Fuerchtet', toTitle: 'Wird gefuerchtet von' },
  { type: 'protects', fromTitle: 'Beschuetzt', toTitle: 'Wird beschuetzt von' },
  { type: 'is_from', fromTitle: 'Ist aus', toTitle: 'Herkunftsort von' },
  { type: 'lives_in', fromTitle: 'Lebt in', toTitle: 'Wohnort von' },
  { type: 'currently_at', fromTitle: 'Ist aktuell bei', toTitle: 'Aktueller Aufenthaltsort von' },
  { type: 'frequently_visits', fromTitle: 'Besucht oft', toTitle: 'Wird oft besucht von' },
  { type: 'belongs_to_place', fromTitle: 'Gehoert zu', toTitle: 'Zugehoerig fuer' },
]

const RELATIONSHIP_TYPE_ALIASES: Record<string, string> = {
  mother: 'mother_of',
  mutter: 'mother_of',
  father: 'father_of',
  vater: 'father_of',
  parent: 'parent_of',
  elternteil: 'parent_of',
  child: 'child_of',
  kind: 'child_of',
  sibling: 'sibling_of',
  geschwister: 'sibling_of',
  cousin: 'cousin_of',
  cousine: 'cousin_of',
  grandparent: 'grandparent_of',
  grosselternteil: 'grandparent_of',
  grandchild: 'grandchild_of',
  enkelkind: 'grandchild_of',
  guardian: 'guardian_of',
  bezugsperson: 'guardian_of',
  ward: 'ward_of',
  schutzling: 'ward_of',
  friend: 'friend_of',
  freund: 'friend_of',
  freundin: 'friend_of',
  freundschaft: 'friend_of',
  best_friend: 'best_friend_of',
  beste_freundin: 'best_friend_of',
  ally: 'ally_of',
  verbuendet: 'ally_of',
  mentor: 'mentor_of',
  schueler: 'student_of',
  student: 'student_of',
  rival: 'rival_of',
  feind: 'enemy_of',
  enemy: 'enemy_of',
  fears: 'fears',
  fuerchtet_sich_vor: 'fears',
  hat_angst_vor: 'fears',
  protects: 'protects',
  is_from: 'is_from',
  lives_in: 'lives_in',
  currently_at: 'currently_at',
  frequently_visits: 'frequently_visits',
  belongs_to_place: 'belongs_to_place',
}

const RELATIONSHIP_TYPE_MAP = new Map<string, RelationshipTypeDefinition>(
  RELATIONSHIP_TYPE_DEFINITIONS.map((entry) => [entry.type, entry]),
)
export const RELATIONSHIP_TYPES = RELATIONSHIP_TYPE_DEFINITIONS.map((entry) => ({
  type: entry.type,
  fromTitle: entry.fromTitle,
  toTitle: entry.toTitle,
}))
const ALLOWED_RELATIONSHIP_TYPES = RELATIONSHIP_TYPE_DEFINITIONS.map((entry) => entry.type) as readonly string[]
const ALLOWED_RELATIONSHIP_TYPE_SET = new Set<string>(ALLOWED_RELATIONSHIP_TYPES)

const resolveTitlePair = (relationshipType: string): { fromTitle: string; toTitle: string } => {
  const normalizedType = relationshipType.trim().toLowerCase()
  const definition = RELATIONSHIP_TYPE_MAP.get(normalizedType)
  if (!definition) return { fromTitle: '', toTitle: '' }
  return { fromTitle: definition.fromTitle, toTitle: definition.toTitle }
}

const deriveSemanticRelationshipType = (rawValues: string[]): string => {
  for (const value of rawValues) {
    const slug = slugifyRelationshipType(value)
    if (!slug) continue
    if (ALLOWED_RELATIONSHIP_TYPE_SET.has(slug)) return slug
    const aliased = RELATIONSHIP_TYPE_ALIASES[slug]
    if (aliased && ALLOWED_RELATIONSHIP_TYPE_SET.has(aliased)) return aliased
    return slug
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
  const titlePair = resolveTitlePair(relationshipType)
  const fromTitle = input.fromTitle?.trim() || titlePair.fromTitle
  const toTitle = input.toTitle?.trim() || titlePair.toTitle
  const relationship = fromTitle || rawRelationship || rawRelationshipTypeReadable
  const relationshipTypeReadable = relationship

  return {
    sourceCharacterId,
    targetCharacterId,
    relationshipType,
    fromTitle,
    toTitle,
    relationshipTypeReadable,
    relationship,
    description: input.description?.trim(),
    properties: input.properties ?? input.metadata,
    metadata: input.properties ?? input.metadata,
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
    throw new Error(
      `relationshipType ist erforderlich. Erlaubte Typen: ${ALLOWED_RELATIONSHIP_TYPES.join(', ')}`,
    )
  }
  if (!ALLOWED_RELATIONSHIP_TYPE_SET.has(input.relationshipType)) {
    throw new Error(
      `Unbekannter relationshipType "${input.relationshipType}". Erlaubte Typen: ${ALLOWED_RELATIONSHIP_TYPES.join(', ')}`,
    )
  }
  if (!input.relationship) {
    throw new Error('relationshipTypeReadable oder relationship ist erforderlich.')
  }
  if (input.properties != null && (typeof input.properties !== 'object' || Array.isArray(input.properties))) {
    throw new Error('properties muss ein Objekt sein.')
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
  const fromTitle = input.fromTitle?.trim() || relationshipTypeReadable
  const toTitle = input.toTitle?.trim() || relationshipTypeReadable

  const db = getPool()
  const result = await db.query<CharacterRelationshipRow>(
    `
    INSERT INTO character_relationships (
      relationship_id,
      source_character_id,
      target_character_id,
      relationship_type,
      from_title,
      to_title,
      relationship_type_readable,
      relationship,
      description,
      metadata,
      other_related_objects
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)
    ON CONFLICT (relationship_id)
    DO UPDATE SET
      source_character_id = EXCLUDED.source_character_id,
      target_character_id = EXCLUDED.target_character_id,
      relationship_type = EXCLUDED.relationship_type,
      from_title = EXCLUDED.from_title,
      to_title = EXCLUDED.to_title,
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
      from_title,
      to_title,
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
      fromTitle,
      toTitle,
      relationshipTypeReadable,
      input.relationship,
      input.description ?? null,
      JSON.stringify(input.properties ?? input.metadata ?? {}),
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
      from_title,
      to_title,
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
      from_title,
      to_title,
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
      from_title,
      to_title,
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
      from_title,
      to_title,
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
  options: Record<string, never> = {},
): Promise<{ tableName: string; created: boolean }> => {
  void options
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
      from_title TEXT,
      to_title TEXT,
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
      ADD COLUMN IF NOT EXISTS from_title TEXT;

    ALTER TABLE character_relationships
      ADD COLUMN IF NOT EXISTS to_title TEXT;

    ALTER TABLE character_relationships
      ADD COLUMN IF NOT EXISTS relationship_type_readable TEXT;

    ALTER TABLE character_relationships
      ADD COLUMN IF NOT EXISTS other_related_objects JSONB NOT NULL DEFAULT '[]'::jsonb;

    UPDATE character_relationships
    SET relationship_type_readable = relationship
    WHERE relationship_type_readable IS NULL OR relationship_type_readable = '';

    UPDATE character_relationships
    SET from_title = relationship_type_readable
    WHERE from_title IS NULL OR from_title = '';

    UPDATE character_relationships
    SET to_title = from_title
    WHERE to_title IS NULL OR to_title = '';

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
  fromTitle: string
  toTitle: string
  relationshipTypeReadable: string
  relationship: string
  description?: string
  properties?: CharacterRelationshipMetadata
  /** @deprecated Use properties instead. Kept for backward compatibility. */
  metadata?: CharacterRelationshipMetadata
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
    fromTitle: record.fromTitle,
    toTitle: record.toTitle,
    relationshipTypeReadable: record.relationshipTypeReadable,
    relationship: record.relationship,
    description: record.description,
    properties: record.properties,
    metadata: record.metadata,
    otherRelatedObjects: record.otherRelatedObjects,
    direction: record.direction,
  }))
}
