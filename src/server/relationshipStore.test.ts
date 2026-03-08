import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock('pg', () => ({
  Pool: class MockPool {
    query = mocks.queryMock
  },
}))

describe('relationshipStore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('persistiert otherRelatedObjects beim Upsert', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: 'nola#romi#freundin',
            source_character_id: 'nola',
            target_character_id: 'romi',
            relationship_type: 'freundin',
            relationship_type_readable: 'Freundin',
            relationship: 'Freundin',
            description: 'kennen sich vom See',
            metadata: {},
            other_related_objects: [{ type: 'place', id: 'crystal-lake', label: 'home_waters' }],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      })

    const { upsertCharacterRelationship } = await import('./relationshipStore.ts')
    const result = await upsertCharacterRelationship({
      sourceCharacterId: 'nola',
      targetCharacterId: 'romi',
      relationshipType: 'freundin',
      relationshipTypeReadable: 'Freundin',
      relationship: 'Freundin',
      otherRelatedObjects: [
        { type: 'place', id: 'crystal-lake', label: 'home_waters' },
        { type: '', id: 'invalid' },
      ],
    })

    expect(result.otherRelatedObjects).toEqual([
      { type: 'place', id: 'crystal-lake', label: 'home_waters' },
    ])
    expect(mocks.queryMock).toHaveBeenCalledTimes(3)

    const upsertCall = mocks.queryMock.mock.calls[2]
    expect(String(upsertCall[0])).toContain('other_related_objects')
    expect(upsertCall[1][8]).toBe(
      JSON.stringify([{ type: 'place', id: 'crystal-lake', label: 'home_waters' }]),
    )
  })

  it('findet Relationships per related object', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: 'nola#romi#freundin',
            source_character_id: 'nola',
            target_character_id: 'romi',
            relationship_type: 'freundin',
            relationship_type_readable: 'Freundin',
            relationship: 'Freundin',
            description: null,
            metadata: {},
            other_related_objects: [
              { type: 'place', id: 'crystal-lake', label: 'home_waters' },
              { type: 'item', id: 'blue-shell' },
            ],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      })

    const { listRelationshipsByOtherRelatedObject } = await import('./relationshipStore.ts')
    const result = await listRelationshipsByOtherRelatedObject('place', 'crystal-lake')

    expect(result).toHaveLength(1)
    expect(result[0].matchedObject).toEqual({
      type: 'place',
      id: 'crystal-lake',
      label: 'home_waters',
    })
    const selectCall = mocks.queryMock.mock.calls[2]
    expect(String(selectCall[0])).toContain('other_related_objects @>')
    expect(selectCall[1][0]).toBe(JSON.stringify([{ type: 'place', id: 'crystal-lake' }]))
  })

  it('normalisiert Beziehungstypen semantisch fuer Filter und Lesbarkeit', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: 'yoko#nola#beste_freundin',
            source_character_id: 'yoko',
            target_character_id: 'nola',
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
      sourceCharacterId: 'yoko',
      targetCharacterId: 'nola',
      relationshipType: 'Freundin',
      relationshipTypeReadable: 'beste Freundin',
      relationship: 'beste Freundin',
    })

    const upsertCall = mocks.queryMock.mock.calls[2]
    expect(upsertCall[1][0]).toBe('yoko#nola#beste_freundin')
    expect(upsertCall[1][3]).toBe('beste_freundin')
    expect(upsertCall[1][4]).toBe('beste Freundin')
    expect(upsertCall[1][5]).toBe('beste Freundin')
  })

  it('kann readable Labels auch ohne relationshipType persistieren', async () => {
    mocks.queryMock
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            relationship_id: 'yoko#nola#schwester',
            source_character_id: 'yoko',
            target_character_id: 'nola',
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
      sourceCharacterId: 'yoko',
      targetCharacterId: 'nola',
      relationshipType: '',
      relationshipTypeReadable: 'Schwester',
      relationship: '',
    })

    const upsertCall = mocks.queryMock.mock.calls[2]
    expect(upsertCall[1][0]).toBe('yoko#nola#schwester')
    expect(upsertCall[1][3]).toBe('schwester')
    expect(upsertCall[1][4]).toBe('Schwester')
    expect(upsertCall[1][5]).toBe('Schwester')
  })
})
