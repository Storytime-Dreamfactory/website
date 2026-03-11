import { describe, expect, it } from 'vitest'
import { selectImageReferencesForPrompt, type CollatedRelatedObject } from './contextCollationService.ts'

describe('selectImageReferencesForPrompt', () => {
  it('waehlt bei Namensnennung passende Referenzen', async () => {
    const relatedObjects: CollatedRelatedObject[] = [
      {
        objectType: 'character',
        objectId: '00000000-0000-4000-8000-000000000002',
        displayName: 'Juna Lia',
        relationshipLinks: [
          {
            relatedCharacterId: '00000000-0000-4000-8000-000000000002',
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
        objectId: '00000000-0000-4000-8000-000000000004',
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

    expect(result.selectedReferences[0]?.objectId).toBe('00000000-0000-4000-8000-000000000002')
  })

  it('bevorzugt Standardfiguren vor Hero-Bildern', async () => {
    const relatedObjects: CollatedRelatedObject[] = [
      {
        objectType: 'character',
        objectId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
        displayName: 'Nola',
        relationshipLinks: [],
        imageRefs: [
          {
            kind: 'hero',
            title: 'Hero',
            path: '/content/characters/nola/hero-image.jpg',
          },
          {
            kind: 'standard',
            title: 'Standard',
            path: '/content/characters/nola/standard-figur.png',
          },
        ],
        evidence: [],
      },
    ]

    const result = await selectImageReferencesForPrompt({
      scenePrompt: 'Nola winkt am Flussufer',
      lastUserText: 'Bitte zeig Nola',
      relatedObjects,
      maxRelatedReferences: 3,
    })

    expect(result.selectedReferences[0]?.imagePath).toBe('/content/characters/nola/standard-figur.png')
  })
})
