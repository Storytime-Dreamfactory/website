import { describe, expect, it } from 'vitest'
import { selectImageReferencesForPrompt, type CollatedRelatedObject } from './contextCollationService.ts'

describe('selectImageReferencesForPrompt', () => {
  it('waehlt bei Namensnennung passende Referenzen', async () => {
    const relatedObjects: CollatedRelatedObject[] = [
      {
        objectType: 'character',
        objectId: 'juna-lia',
        displayName: 'Juna Lia',
        relationshipLinks: [
          {
            relatedCharacterId: 'juna-lia',
            direction: 'outgoing',
            relationshipType: 'freundin',
            relationshipTypeReadable: 'Freundin',
            relationship: 'Freundin',
          },
        ],
        imageRefs: [
          {
            kind: 'standard',
            title: 'Standard',
            path: '/content/characters/juna-lia/standard-figur.png',
          },
        ],
        evidence: [],
      },
      {
        objectType: 'character',
        objectId: 'carla',
        displayName: 'Carla',
        relationshipLinks: [],
        imageRefs: [
          {
            kind: 'standard',
            title: 'Standard',
            path: '/content/characters/carla/standard-figur.png',
          },
        ],
        evidence: [],
      },
    ]

    const result = await selectImageReferencesForPrompt({
      scenePrompt: 'Nola und Juna Lia spielen am Fluss',
      lastUserText: 'Bitte zeig Juna Lia mit im Bild',
      relatedObjects,
      maxRelatedReferences: 3,
    })

    expect(result.selectedReferences[0]?.objectId).toBe('juna-lia')
  })
})
