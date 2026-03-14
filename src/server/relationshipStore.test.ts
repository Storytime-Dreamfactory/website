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
            relationship_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0#e3bf634f-af12-4d51-aeb1-d1464bea2d13#friend_of',
            source_character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
            target_character_id: 'e3bf634f-af12-4d51-aeb1-d1464bea2d13',
            relationship_type: 'friend_of',
            from_title: 'Freundschaft',
            to_title: 'Freundschaft',
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
      relationshipType: 'friend_of',
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
    expect(upsertCall[1][10]).toBe(
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
            relationship_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0#e3bf634f-af12-4d51-aeb1-d1464bea2d13#friend_of',
            source_character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
            target_character_id: 'e3bf634f-af12-4d51-aeb1-d1464bea2d13',
            relationship_type: 'friend_of',
            from_title: 'Freundschaft',
            to_title: 'Freundschaft',
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

  it('normalisiert Beziehungstypen auf kanonische Ontology-Typen', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: '00000000-0000-4000-8000-000000000001#8eb40291-65ee-49b6-b826-d7c7e97404c0#friend_of',
            source_character_id: '00000000-0000-4000-8000-000000000001',
            target_character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
            relationship_type: 'friend_of',
            from_title: 'Freundschaft',
            to_title: 'Freundschaft',
            relationship_type_readable: 'Freundschaft',
            relationship: 'Freundschaft',
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
      relationshipTypeReadable: 'Freundin',
      relationship: 'Freundin',
    })

    const upsertCall = mocks.queryMock.mock.calls[2]
    expect(upsertCall[1][0]).toBe('00000000-0000-4000-8000-000000000001#8eb40291-65ee-49b6-b826-d7c7e97404c0#friend_of')
    expect(upsertCall[1][3]).toBe('friend_of')
    expect(upsertCall[1][4]).toBe('Freundschaft')
    expect(upsertCall[1][5]).toBe('Freundschaft')
  })

  it('weist unbekannte relationshipType-Werte ab', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })

    const { upsertCharacterRelationship } = await import('./relationshipStore.ts')
    await expect(
      upsertCharacterRelationship({
        sourceCharacterId: '00000000-0000-4000-8000-000000000001',
        targetCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
        relationshipType: 'space_wizard',
        relationship: 'Space Wizard',
      }),
    ).rejects.toThrow('Unbekannter relationshipType')
  })

  it('liefert beim Listen kanonische UUIDs im Output', async () => {
    mocks.queryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('SELECT EXISTS')) return { rows: [{ exists: true }] }
      if (text.includes('CREATE TABLE IF NOT EXISTS character_relationships')) return { rows: [] }
      if (text.includes('FROM character_relationships')) {
        return {
          rows: [
            {
              relationship_id: 'flora-blumenfreude#8eb40291-65ee-49b6-b826-d7c7e97404c0#friend_of',
              source_character_id: 'flora-blumenfreude',
              target_character_id: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
              relationship_type: 'friend_of',
              from_title: 'Freundschaft',
              to_title: 'Freundschaft',
              relationship_type_readable: 'Freundschaft',
              relationship: 'Freundschaft',
              description: null,
              metadata: {},
              other_related_objects: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        }
      }
      return { rows: [] }
    })

    const { listAllRelationships } = await import('./relationshipStore.ts')
    const result = await listAllRelationships()

    expect(result).toHaveLength(1)
    expect(result[0]?.sourceCharacterId).toBe('78a52cad-30b5-468f-9687-c50c30a4bd39')
    expect(result[0]?.targetCharacterId).toBe('8eb40291-65ee-49b6-b826-d7c7e97404c0')
    expect(result[0]?.relationshipTypeReadable).toBe('Freundschaft')
    expect(result[0]?.relationship).toBe('Freundschaft')
  })
})
