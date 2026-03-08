import { ensureCharacterRelationshipTable } from '../src/server/relationshipStore.ts'

const run = async (): Promise<void> => {
  const result = await ensureCharacterRelationshipTable()

  if (result.created) {
    console.log(`Postgres table created: ${result.tableName}`)
    return
  }

  console.log(`Postgres table already exists: ${result.tableName}`)
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
