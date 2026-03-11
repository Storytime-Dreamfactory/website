import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'

type SlugMappingFile = {
  characters?: Record<string, string>
  places?: Record<string, string>
  learningGoals?: Record<string, string>
}

type RelationshipRow = {
  relationship_id: string
  source_character_id: string
  target_character_id: string
  relationship_type: string
  relationship_type_readable: string | null
  relationship: string
  description: string | null
  metadata: Record<string, unknown> | null
  other_related_objects: Array<{
    type?: string
    id?: string
    label?: string
    metadata?: Record<string, unknown>
  }> | null
  created_at: string
  updated_at: string
}

type CanonicalRelationshipRow = {
  relationshipId: string
  sourceCharacterId: string
  targetCharacterId: string
  relationshipType: string
  relationshipTypeReadable: string | null
  relationship: string
  description: string | null
  metadata: Record<string, unknown>
  otherRelatedObjects: Array<{
    type: string
    id: string
    label?: string
    metadata?: Record<string, unknown>
  }>
  createdAt: string
  updatedAt: string
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(__dirname, '..')
const mappingPath = path.resolve(workspaceRoot, 'tools/migrations/slug-to-uuid-mapping.json')
const DEFAULT_DATABASE_URL = 'postgres://storytime:storytime@localhost:5433/storytime'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const loadMappings = async (): Promise<Map<string, string>> => {
  const raw = await readFile(mappingPath, 'utf8')
  const parsed = JSON.parse(raw) as SlugMappingFile
  const mappings = new Map<string, string>()

  for (const section of [parsed.characters, parsed.places, parsed.learningGoals]) {
    for (const [slug, uuid] of Object.entries(section ?? {})) {
      mappings.set(slug, uuid)
    }
  }

  return mappings
}

const canonicalizeId = (value: string, mappings: Map<string, string>): string => {
  const normalized = value.trim()
  if (!normalized) return normalized
  if (UUID_RE.test(normalized)) return normalized
  return mappings.get(normalized) ?? normalized
}

const canonicalizeOtherRelatedObjects = (
  objects: RelationshipRow['other_related_objects'],
  mappings: Map<string, string>,
): CanonicalRelationshipRow['otherRelatedObjects'] => {
  if (!Array.isArray(objects)) return []
  return objects.flatMap((item) => {
    const type = typeof item?.type === 'string' ? item.type.trim() : ''
    const id = typeof item?.id === 'string' ? canonicalizeId(item.id, mappings) : ''
    if (!type || !id) return []
    return [
      {
        type,
        id,
        label: typeof item?.label === 'string' && item.label.trim() ? item.label.trim() : undefined,
        metadata:
          item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
            ? item.metadata
            : undefined,
      },
    ]
  })
}

const toRelationshipId = (sourceId: string, targetId: string, relationshipType: string): string =>
  [sourceId.trim(), targetId.trim(), relationshipType.trim()]
    .map((item) => item.toLowerCase())
    .join('#')

const toCanonicalRelationship = (
  row: RelationshipRow,
  mappings: Map<string, string>,
): CanonicalRelationshipRow => {
  const sourceCharacterId = canonicalizeId(row.source_character_id, mappings)
  const targetCharacterId = canonicalizeId(row.target_character_id, mappings)
  const relationshipType = row.relationship_type.trim()

  return {
    relationshipId: toRelationshipId(sourceCharacterId, targetCharacterId, relationshipType),
    sourceCharacterId,
    targetCharacterId,
    relationshipType,
    relationshipTypeReadable: row.relationship_type_readable,
    relationship: row.relationship,
    description: row.description,
    metadata: row.metadata ?? {},
    otherRelatedObjects: canonicalizeOtherRelatedObjects(row.other_related_objects, mappings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const compareIsoDesc = (left: string, right: string): number =>
  new Date(right).getTime() - new Date(left).getTime()

const run = async (): Promise<void> => {
  const mappings = await loadMappings()
  const client = new Client({
    connectionString: process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL,
  })

  await client.connect()

  try {
    await client.query('BEGIN')

    const result = await client.query<RelationshipRow>(`
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
      ORDER BY updated_at DESC, created_at DESC
    `)

    const canonicalRows = result.rows.map((row) => toCanonicalRelationship(row, mappings))
    const deduped = new Map<string, CanonicalRelationshipRow>()

    for (const row of canonicalRows) {
      const existing = deduped.get(row.relationshipId)
      if (!existing) {
        deduped.set(row.relationshipId, row)
        continue
      }

      if (compareIsoDesc(row.updatedAt, existing.updatedAt) < 0) {
        continue
      }

      deduped.set(row.relationshipId, row)
    }

    await client.query('DELETE FROM character_relationships')

    for (const row of deduped.values()) {
      await client.query(
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
          other_related_objects,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::timestamptz, $11::timestamptz)
        `,
        [
          row.relationshipId,
          row.sourceCharacterId,
          row.targetCharacterId,
          row.relationshipType,
          row.relationshipTypeReadable,
          row.relationship,
          row.description,
          JSON.stringify(row.metadata),
          JSON.stringify(row.otherRelatedObjects),
          row.createdAt,
          row.updatedAt,
        ],
      )
    }

    await client.query('COMMIT')

    const overwrittenRows = result.rows.length
    const remainingRows = deduped.size
    const migratedRowCount = canonicalRows.filter(
      (row, index) =>
        row.sourceCharacterId !== result.rows[index]?.source_character_id ||
        row.targetCharacterId !== result.rows[index]?.target_character_id ||
        row.relationshipId !== result.rows[index]?.relationship_id,
    ).length

    console.log(
      JSON.stringify(
        {
          overwrittenRows,
          remainingRows,
          migratedRowCount,
        },
        null,
        2,
      ),
    )
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    await client.end()
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
