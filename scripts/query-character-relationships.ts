import {
  listRelationshipsByOtherRelatedObject,
  listRelationshipsForCharacter,
} from '../src/server/relationshipStore.ts'

const run = async (): Promise<void> => {
  const args = process.argv.slice(2)
  const objectTypeArgIndex = args.indexOf('--object-type')
  const objectIdArgIndex = args.indexOf('--object-id')

  if (objectTypeArgIndex >= 0 || objectIdArgIndex >= 0) {
    const objectType = objectTypeArgIndex >= 0 ? args[objectTypeArgIndex + 1]?.trim() : ''
    const objectId = objectIdArgIndex >= 0 ? args[objectIdArgIndex + 1]?.trim() : ''
    if (!objectType || !objectId) {
      console.error(
        'Usage: npm run db:query-relationships -- --object-type <type> --object-id <id>',
      )
      process.exitCode = 1
      return
    }
    const matches = await listRelationshipsByOtherRelatedObject(objectType, objectId)
    console.log(
      JSON.stringify(
        {
          objectType,
          objectId,
          count: matches.length,
          matches,
        },
        null,
        2,
      ),
    )
    return
  }

  const characterId = args[0]?.trim()
  if (!characterId) {
    console.error(
      'Usage: npm run db:query-relationships -- <characterId> OR --object-type <type> --object-id <id>',
    )
    process.exitCode = 1
    return
  }
  const relationships = await listRelationshipsForCharacter(characterId)
  console.log(JSON.stringify({ characterId, count: relationships.length, relationships }, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
