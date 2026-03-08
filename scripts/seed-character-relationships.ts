import { access, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import {
  ensureCharacterRelationshipTable,
  upsertCharacterRelationship,
  type CharacterRelationshipMetadata,
} from '../src/server/relationshipStore.ts'

type RelationshipYamlRecord = {
  character_id?: unknown
  typ?: unknown
  beschreibung?: unknown
}

type RelatedPlaceYamlRecord = {
  place_id?: unknown
  typ?: unknown
  beschreibung?: unknown
}

type CharacterYamlRecord = {
  relationships?: {
    characters?: unknown
    places?: unknown
  }
}

const toRelationshipType = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'related_to'

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

const run = async (): Promise<void> => {
  await ensureCharacterRelationshipTable()

  const charactersRoot = path.resolve(process.cwd(), 'content/characters')
  const entries = await readdir(charactersRoot, { withFileTypes: true })
  const directories = entries.filter((entry) => entry.isDirectory())

  let insertedOrUpdated = 0
  let skipped = 0

  for (const directory of directories) {
    const sourceCharacterId = directory.name
    const yamlPath = path.resolve(charactersRoot, sourceCharacterId, 'character.yaml')

    if (!(await fileExists(yamlPath))) {
      continue
    }

    const rawYaml = await readFile(yamlPath, 'utf8')
    const parsed = parseYaml(rawYaml) as CharacterYamlRecord
    const relationships = parsed.relationships?.characters
    const places = parsed.relationships?.places
    const otherRelatedObjects = Array.isArray(places)
      ? places
          .filter((entry): entry is RelatedPlaceYamlRecord => Boolean(entry && typeof entry === 'object'))
          .map((entry) => {
            const placeId = typeof entry.place_id === 'string' ? entry.place_id.trim() : ''
            if (!placeId) return null
            const placeType = typeof entry.typ === 'string' ? entry.typ.trim() : undefined
            const description =
              typeof entry.beschreibung === 'string' ? entry.beschreibung.trim() || undefined : undefined
            return {
              type: 'place',
              id: placeId,
              label: placeType,
              metadata: description ? { description } : undefined,
            }
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : []

    if (!Array.isArray(relationships)) {
      continue
    }

    for (const relation of relationships) {
      if (!relation || typeof relation !== 'object') {
        skipped += 1
        continue
      }

      const relationRecord = relation as RelationshipYamlRecord
      const targetCharacterId =
        typeof relationRecord.character_id === 'string' ? relationRecord.character_id.trim() : ''
      const relationshipLabel =
        typeof relationRecord.typ === 'string' ? relationRecord.typ.trim() : ''
      const description =
        typeof relationRecord.beschreibung === 'string'
          ? relationRecord.beschreibung.trim() || undefined
          : undefined

      if (!targetCharacterId) {
        skipped += 1
        continue
      }

      const relationship = relationshipLabel || 'related_to'
      const relationshipType = toRelationshipType(relationship)
      const metadata: CharacterRelationshipMetadata = {
        source: 'content/characters/*/character.yaml',
        sourceField: 'relationships.characters',
        relationshipLabel,
      }

      await upsertCharacterRelationship({
        sourceCharacterId,
        targetCharacterId,
        relationshipType,
        relationshipTypeReadable: relationshipLabel || relationship,
        relationship,
        description,
        metadata,
        otherRelatedObjects,
      })
      insertedOrUpdated += 1
    }
  }

  console.log(
    JSON.stringify(
      {
        insertedOrUpdated,
        skipped,
      },
      null,
      2,
    ),
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
