import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadStoryContent } from './loaders'

describe('loadStoryContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('laedt Runtime-Content ueber die GameObjects API', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gameObjects: [
            {
              id: '78a52cad-30b5-468f-9687-c50c30a4bd39',
              name: 'Flora Blumenfreude',
              type: 'character',
              slug: 'flora-blumenfreude',
              shortDescription: 'Hilfsbereit und optimistisch.',
              basis: { species: 'Mensch' },
              voice: 'coral',
              voiceProfile: {
                identity: 'Freundliche Helferin',
                demeanor: 'ermutigend',
                tone: 'warm',
                enthusiasmLevel: 'hoch',
                formalityLevel: 'locker',
                emotionLevel: 'ausdrucksstark',
                fillerWords: 'occasionally',
                pacing: 'lebendig',
              },
              appearance: {
                bodyShape: 'schlank',
                colors: ['gelb'],
                hairOrFur: {},
                eyes: { color: 'blau', expression: 'offen' },
                distinctiveFeatures: [],
                clothingStyle: 'floral',
              },
              personality: {
                coreTraits: ['hilfsbereit'],
                temperament: 'lebhaft',
                socialStyle: 'offen',
                strengths: [],
                weaknesses: [],
                quirks: [],
              },
              storyPsychology: {
                visibleGoal: 'helfen',
                deeperNeed: 'Geborgenheit',
                fear: 'Alleinsein',
                insecurity: 'nicht zu genuegen',
                stressResponse: 'hesitate_then_try',
                growthDirection: 'um Hilfe bitten',
              },
              learningFunction: {
                teachingRoles: ['helper'],
                suitableLearningGoals: ['freundlichkeit'],
                explanationStyle: 'playful',
              },
              images: {
                standardFigure: {},
                heroImage: {},
                portrait: {},
                profileImage: {},
                additionalImages: [],
              },
              tags: [],
              metadata: {
                active: true,
                createdAt: '2026-03-09',
                updatedAt: '2026-03-09',
                version: 1,
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gameObjects: [
            {
              id: 'ce0cc7ef-99e8-4138-a3ac-a6255e891532',
              name: 'Whispering Meadow',
              type: 'place',
              slug: 'whispering-meadow',
              description: 'Eine Wiese.',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gameObjects: [
            {
              id: '313ab6c5-0d07-48d6-aae6-458a0218c020',
              name: 'Freundlichkeit',
              type: 'learning-goals',
              slug: 'kindness',
              topic: 'Sozial',
              description: 'Freundlich sein',
              ageRange: ['4-6'],
              exampleQuestions: [],
              practiceIdeas: [],
              domainTags: [],
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          gameObjects: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          relationships: [
            {
              sourceCharacterId: '78a52cad-30b5-468f-9687-c50c30a4bd39',
              targetCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
              relationshipType: 'freundin',
              relationship: 'Freundin',
              description: 'Hilft gern am Fluss.',
            },
          ],
        }),
      })

    vi.stubGlobal('fetch', fetchMock)

    const result = await loadStoryContent()

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/game-objects?type=character')
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/game-objects?type=place')
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/game-objects?type=learning-goals')
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/game-objects?type=artifact')
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/relationships/all')
    expect(result.source).toBe('runtime')
    expect(result.characters[0]?.id).toBe('78a52cad-30b5-468f-9687-c50c30a4bd39')
    expect(result.places[0]?.slug).toBe('whispering-meadow')
  })
})
