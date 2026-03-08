import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listRelationshipsByOtherRelatedObjectMock: vi.fn(),
  appendConversationMessageMock: vi.fn(),
  trackRuntimeToolActivitySafelyMock: vi.fn(),
  trackTraceActivitySafelyMock: vi.fn(),
  collateRelatedCharacterObjectsMock: vi.fn(),
}))

vi.mock('../../relationshipStore.ts', () => ({
  listRelationshipsByOtherRelatedObject: mocks.listRelationshipsByOtherRelatedObjectMock,
}))

vi.mock('../../conversationStore.ts', () => ({
  appendConversationMessage: mocks.appendConversationMessageMock,
}))

vi.mock('./runtimeToolActivityLogger.ts', () => ({
  trackRuntimeToolActivitySafely: mocks.trackRuntimeToolActivitySafelyMock,
}))

vi.mock('../../traceActivity.ts', () => ({
  trackTraceActivitySafely: mocks.trackTraceActivitySafelyMock,
}))

vi.mock('../context/contextCollationService.ts', () => ({
  collateRelatedCharacterObjects: mocks.collateRelatedCharacterObjectsMock,
}))

import { readRelatedObjectContextsTool } from './readRelatedObjectContextsTool.ts'

describe('readRelatedObjectContextsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.trackRuntimeToolActivitySafelyMock.mockResolvedValue(undefined)
    mocks.trackTraceActivitySafelyMock.mockResolvedValue(undefined)
    mocks.appendConversationMessageMock.mockResolvedValue(undefined)
    mocks.collateRelatedCharacterObjectsMock.mockResolvedValue([])
  })

  it('laedt reverse Kontexte fuer ein related object', async () => {
    mocks.listRelationshipsByOtherRelatedObjectMock.mockResolvedValue([
      {
        relationship: {
          relationshipId: 'nola#romi#freundin',
          sourceCharacterId: 'nola',
          targetCharacterId: 'romi',
          relationshipType: 'freundin',
          relationshipTypeReadable: 'Freundin',
          relationship: 'Freundin',
          description: undefined,
          metadata: {},
          otherRelatedObjects: [{ type: 'place', id: 'crystal-lake' }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        matchedObject: { type: 'place', id: 'crystal-lake' },
      },
    ])

    const result = await readRelatedObjectContextsTool.execute(
      {
        conversationId: 'conv-1',
        characterId: 'nola',
        characterName: 'Nola',
      },
      {
        objectType: 'place',
        objectId: 'crystal-lake',
      },
    )

    expect(result).toEqual(
      expect.objectContaining({
        matchCount: 1,
        relatedCharacterIds: ['romi'],
        matchedContexts: expect.any(Array),
        relatedObjects: expect.any(Array),
      }),
    )
    expect(mocks.listRelationshipsByOtherRelatedObjectMock).toHaveBeenCalledWith(
      'place',
      'crystal-lake',
    )
    expect(mocks.appendConversationMessageMock).toHaveBeenCalled()
  })

  it('wirft Fehler ohne objectType/objectId', async () => {
    await expect(
      readRelatedObjectContextsTool.execute(
        {
          conversationId: 'conv-1',
          characterId: 'nola',
          characterName: 'Nola',
        },
        {
          objectType: '',
          objectId: '',
        },
      ),
    ).rejects.toThrow('objectType und objectId sind erforderlich.')
  })
})
