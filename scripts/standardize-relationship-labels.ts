import { Client } from 'pg'

const DEFAULT_DATABASE_URL = 'postgres://storytime:storytime@localhost:5433/storytime'

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
  if (!normalizedType) return ''
  return normalizedType
    .split('_')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

const run = async (): Promise<void> => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL?.trim() || DEFAULT_DATABASE_URL,
  })
  await client.connect()

  try {
    await client.query('BEGIN')

    const result = await client.query<{
      relationship_id: string
      relationship_type: string
      relationship_type_readable: string | null
      relationship: string
    }>(`
      SELECT relationship_id, relationship_type, relationship_type_readable, relationship
      FROM character_relationships
    `)

    let updated = 0
    for (const row of result.rows) {
      const label = toStandardRelationshipLabel(row.relationship_type)
      if (!label) continue
      if (row.relationship_type_readable === label && row.relationship === label) continue

      await client.query(
        `
        UPDATE character_relationships
        SET relationship_type_readable = $2,
            relationship = $2
        WHERE relationship_id = $1
        `,
        [row.relationship_id, label],
      )
      updated += 1
    }

    await client.query('COMMIT')
    console.log(JSON.stringify({ total: result.rowCount, updated }, null, 2))
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
