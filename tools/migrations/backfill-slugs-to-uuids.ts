/**
 * Backfill-Migration: Replaces slug-based IDs in the database
 * (character_activities, character_relationships, conversations)
 * with the canonical UUIDs from the slug-to-uuid mapping.
 *
 * Usage:  npx tsx tools/migrations/backfill-slugs-to-uuids.ts
 *
 * Set DATABASE_URL or STORYTIME_DATABASE_URL before running.
 * Runs in a transaction; rolls back on error.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type SlugMapping = {
  characters: Record<string, string>
  places: Record<string, string>
  learningGoals: Record<string, string>
}

const loadMapping = (): Map<string, string> => {
  const raw = readFileSync(path.resolve(__dirname, 'slug-to-uuid-mapping.json'), 'utf8')
  const data = JSON.parse(raw) as SlugMapping
  const map = new Map<string, string>()
  for (const section of Object.values(data)) {
    for (const [slug, uuid] of Object.entries(section)) {
      map.set(slug, uuid)
    }
  }
  return map
}

const getDatabaseUrl = (): string => {
  const url = process.env.STORYTIME_DATABASE_URL ?? process.env.DATABASE_URL
  if (!url) {
    throw new Error('Set STORYTIME_DATABASE_URL or DATABASE_URL')
  }
  return url
}

const run = async () => {
  const mapping = loadMapping()
  const client = new pg.Client({ connectionString: getDatabaseUrl() })
  await client.connect()

  try {
    await client.query('BEGIN')

    let updatedActivities = 0
    let updatedRelationships = 0

    for (const [slug, uuid] of mapping) {
      const activityCharacter = await client.query(
        `UPDATE character_activities SET character_id = $2 WHERE character_id = $1 AND character_id != $2`,
        [slug, uuid],
      )
      updatedActivities += activityCharacter.rowCount ?? 0

      const activityPlace = await client.query(
        `UPDATE character_activities SET place_id = $2 WHERE place_id = $1 AND place_id != $2`,
        [slug, uuid],
      )
      updatedActivities += activityPlace.rowCount ?? 0

      const relSource = await client.query(
        `UPDATE character_relationships SET source_character_id = $2 WHERE source_character_id = $1 AND source_character_id != $2`,
        [slug, uuid],
      )
      updatedRelationships += relSource.rowCount ?? 0

      const relTarget = await client.query(
        `UPDATE character_relationships SET target_character_id = $2 WHERE target_character_id = $1 AND target_character_id != $2`,
        [slug, uuid],
      )
      updatedRelationships += relTarget.rowCount ?? 0
    }

    // Backfill learning_goal_ids arrays
    for (const [slug, uuid] of mapping) {
      await client.query(
        `UPDATE character_activities
         SET learning_goal_ids = array_replace(learning_goal_ids, $1, $2)
         WHERE $1 = ANY(learning_goal_ids)`,
        [slug, uuid],
      )
    }

    // Backfill other_related_objects JSONB in relationships
    for (const [slug, uuid] of mapping) {
      await client.query(
        `UPDATE character_relationships
         SET other_related_objects = replace(other_related_objects::text, $1, $2)::jsonb
         WHERE other_related_objects::text LIKE '%' || $1 || '%'`,
        [slug, uuid],
      )
    }

    await client.query('COMMIT')
    console.log(
      `Backfill complete: ${updatedActivities} activity rows, ${updatedRelationships} relationship rows updated.`,
    )
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Backfill failed, rolled back:', error)
    process.exit(1)
  } finally {
    await client.end()
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
