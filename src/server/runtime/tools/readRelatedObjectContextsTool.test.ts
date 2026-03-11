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
          relationshipId: '8eb40291-65ee-49b6-b826-d7c7e97404c0#e3bf634f-af12-4d51-aeb1-d1464bea2d13#freundin',
          sourceCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
          targetCharacterId: 'e3bf634f-af12-4d51-aeb1-d1464bea2d13',
          relationshipType: 'freundin',
          relationshipTypeReadable: 'Freundin',
          relationship: 'Freundin',
          description: undefined,
          metadata: {},
          otherRelatedObjects: [{ type: 'place', id: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a' }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        matchedObject: { type: 'place', id: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a' },
      },
    ])

    const result = await readRelatedObjectContextsTool.execute(
      {
        conversationId: 'conv-1',
        characterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
        characterName: 'Nola',
      },
      {
        objectType: 'place',
        objectId: 'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a',
      },
    )

    expect(result).toEqual(
      expect.objectContaining({
        matchCount: 1,
        relatedCharacterIds: ['e3bf634f-af12-4d51-aeb1-d1464bea2d13'],
        matchedContexts: expect.any(Array),
        relatedObjects: expect.any(Array),
      }),
    )
    expect(mocks.listRelationshipsByOtherRelatedObjectMock).toHaveBeenCalledWith(
      'place',
      'cb8ce8f2-1b10-48b9-8afc-905a7a8d060a',
    )
    expect(mocks.appendConversationMessageMock).toHaveBeenCalled()
  })

  it('wirft Fehler ohne objectType/objectId', async () => {
    await expect(
      readRelatedObjectContextsTool.execute(
        {
          conversationId: 'conv-1',
          characterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
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
