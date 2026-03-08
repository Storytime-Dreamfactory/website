import { listRelationshipsForCharacter } from '../src/server/relationshipStore.ts'

const run = async (): Promise<void> => {
  const characterId = process.argv[2]?.trim()

  if (!characterId) {
    console.error('Usage: npm run db:query-relationships -- <characterId>')
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
