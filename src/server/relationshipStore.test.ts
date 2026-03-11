import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
  gameObjectGetMock: vi.fn(),
}))

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.queryMock
  },
}))

vi.mock('./gameObjectService.ts', () => ({
  get: mocks.gameObjectGetMock,
  getContextBatch: vi.fn(),
}))

describe('relationshipStore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.gameObjectGetMock.mockImplementation(async (id: string) => {
      if (id === 'flora-blumenfreude') {
        return {
          id: '78a52cad-30b5-468f-9687-c50c30a4bd39',
          slug: 'flora-blumenfreude',
          type: 'character',
          name: 'Flora Blumenfreude',
        }
      }
      return {
        id,
        slug: id,
        type: 'character',
        name: id,
      }
    })
  })

  it('persistiert otherRelatedObjects beim Upsert', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0#e3bf634f-af12-4d51-aeb1-d1464bea2d13#freundin',
            source_character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
            target_character_id: 'e3bf634f-af12-4d51-aeb1-d1464bea2d13',
            relationship_type: 'freundin',
            relationship_type_readable: 'Freundin',
            relationship: 'Freundin',
            description: 'kennen sich vom See',
            metadata: {},
            other_related_objects: [{ type: 'place', id: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a', label: 'home_waters' }],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      })

    const { upsertCharacterRelationship } = await import('./relationshipStore.ts')
    const result = await upsertCharacterRelationship({
      sourceCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
      targetCharacterId: 'e3bf634f-af12-4d51-aeb1-d1464bea2d13',
      relationshipType: 'freundin',
      relationshipTypeReadable: 'Freundin',
      relationship: 'Freundin',
      otherRelatedObjects: [
        { type: 'place', id: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a', label: 'home_waters' },
        { type: '', id: 'invalid' },
      ],
    })

    expect(result.otherRelatedObjects).toEqual([
      { type: 'place', id: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a', label: 'home_waters' },
    ])
    expect(mocks.queryMock).toHaveBeenCalledTimes(3)

    const upsertCall = mocks.queryMock.mock.calls[2]
    expect(String(upsertCall[0])).toContain('other_related_objects')
    expect(upsertCall[1][8]).toBe(
      JSON.stringify([{ type: 'place', id: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a', label: 'home_waters' }]),
    )
  })

  it('findet Relationships per related object', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0#e3bf634f-af12-4d51-aeb1-d1464bea2d13#freundin',
            source_character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
            target_character_id: 'e3bf634f-af12-4d51-aeb1-d1464bea2d13',
            relationship_type: 'freundin',
            relationship_type_readable: 'Freundin',
            relationship: 'Freundin',
            description: null,
            metadata: {},
            other_related_objects: [
              { type: 'place', id: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a', label: 'home_waters' },
              { type: 'item', id: 'blue-shell' },
            ],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      })

    const { listRelationshipsByOtherRelatedObject } = await import('./relationshipStore.ts')
    const result = await listRelationshipsByOtherRelatedObject('place', 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a')

    expect(result).toHaveLength(1)
    expect(result[0].matchedObject).toEqual({
      type: 'place',
      id: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a',
      label: 'home_waters',
    })
    const selectCall = mocks.queryMock.mock.calls[2]
    expect(String(selectCall[0])).toContain('other_related_objects @>')
    expect(selectCall[1][0]).toBe(JSON.stringify([{ type: 'place', id: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a' }]))
  })

  it('normalisiert Beziehungstypen semantisch fuer Filter und Lesbarkeit', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: '00000000-0000-4000-8000-000000000001#8eb40291-65ee-49b6-b826-d7c7e97404c0#beste_freundin',
            source_character_id: '00000000-0000-4000-8000-000000000001',
            target_character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
            relationship_type: 'beste_freundin',
            relationship_type_readable: 'beste Freundin',
            relationship: 'beste Freundin',
            description: null,
            metadata: {},
            other_related_objects: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      })

    const { upsertCharacterRelationship } = await import('./relationshipStore.ts')
    await upsertCharacterRelationship({
      sourceCharacterId: '00000000-0000-4000-8000-000000000001',
      targetCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
      relationshipType: 'Freundin',
      relationshipTypeReadable: 'beste Freundin',
      relationship: 'beste Freundin',
    })

    const upsertCall = mocks.queryMock.mock.calls[2]
    expect(upsertCall[1][0]).toBe('00000000-0000-4000-8000-000000000001#8eb40291-65ee-49b6-b826-d7c7e97404c0#beste_freundin')
    expect(upsertCall[1][3]).toBe('beste_freundin')
    expect(upsertCall[1][4]).toBe('Beste Freundin')
    expect(upsertCall[1][5]).toBe('Beste Freundin')
  })

  it('kann readable Labels auch ohne relationshipType persistieren', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: '00000000-0000-4000-8000-000000000001#8eb40291-65ee-49b6-b826-d7c7e97404c0#schwester',
            source_character_id: '00000000-0000-4000-8000-000000000001',
            target_character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
            relationship_type: 'schwester',
            relationship_type_readable: 'Schwester',
            relationship: 'Schwester',
            description: null,
            metadata: {},
            other_related_objects: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      })

    const { upsertCharacterRelationship } = await import('./relationshipStore.ts')
    await upsertCharacterRelationship({
      sourceCharacterId: '00000000-0000-4000-8000-000000000001',
      targetCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
      relationshipType: '',
      relationshipTypeReadable: 'Schwester',
      relationship: '',
    })

    const upsertCall = mocks.queryMock.mock.calls[2]
    expect(upsertCall[1][0]).toBe('00000000-0000-4000-8000-000000000001#8eb40291-65ee-49b6-b826-d7c7e97404c0#schwester')
    expect(upsertCall[1][3]).toBe('schwester')
    expect(upsertCall[1][4]).toBe('Schwester')
    expect(upsertCall[1][5]).toBe('Schwester')
  })

  it('liefert beim Listen kanonische UUIDs im Output', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: 'flora-blumenfreude#8eb40291-65ee-49b6-b826-d7c7e97404c0#freundin',
            source_character_id: 'flora-blumenfreude',
            target_character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
            relationship_type: 'freundin',
            relationship_type_readable: 'Freundin',
            relationship: 'Freundin',
            description: null,
            metadata: {},
            other_related_objects: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      })

    const { listAllRelationships } = await import('./relationshipStore.ts')
    const result = await listAllRelationships()

    expect(result).toHaveLength(1)
    expect(result[0]?.sourceCharacterId).toBe('78a52cad-30b5-468f-9687-c50c30a4bd39')
    expect(result[0]?.targetCharacterId).toBe('8eb40291-65ee-49b6-b826-d7c7e97404c0')
    expect(result[0]?.relationshipTypeReadable).toBe('Freundin')
    expect(result[0]?.relationship).toBe('Freundin')
  })
})
