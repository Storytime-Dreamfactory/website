import { beforeEach, describe, expect, it, vi } from 'vitest'
const traceMock = vi.hoisted(() => vi.fn())
const createActivityMock = vi.hoisted(() => vi.fn())
const appendConversationMessageMock = vi.hoisted(() => vi.fn())
const recallMock = vi.hoisted(() => vi.fn())
const generateHeroMock = vi.hoisted(() => vi.fn())
const runQuizMock = vi.hoisted(() => vi.fn())
const readActivitiesExecuteMock = vi.hoisted(() => vi.fn())
const readConversationHistoryExecuteMock = vi.hoisted(() => vi.fn())
const readRelationshipsExecuteMock = vi.hoisted(() => vi.fn())
const readRelatedObjectsExecuteMock = vi.hoisted(() => vi.fn())
const readRelatedObjectContextsExecuteMock = vi.hoisted(() => vi.fn())
const showImageExecuteMock = vi.hoisted(() => vi.fn())
const resolveCharacterImageRefsMock = vi.hoisted(() => vi.fn())

vi.mock('../../traceActivity.ts', () => ({
  trackTraceActivitySafely: traceMock,
}))

vi.mock('../../activityStore.ts', () => ({
  createActivity: createActivityMock,
}))

vi.mock('../../conversationStore.ts', () => ({
  appendConversationMessage: appendConversationMessageMock,
}))

vi.mock('../../conversationImageMemoryToolService.ts', () => ({
  recallConversationImage: recallMock,
}))

vi.mock('../tools/toolApiService.ts', () => ({
  generateConversationHeroToolApi: generateHeroMock,
}))

vi.mock('../../conversationQuizToolService.ts', () => ({
  runConversationQuizSkill: runQuizMock,
}))

vi.mock('../context/contextCollationService.ts', () => ({
  resolveCharacterImageRefs: resolveCharacterImageRefsMock,
}))

vi.mock('../tools/runtimeToolRegistry.ts', () => ({
  readActivitiesRuntimeTool: () => ({
    execute: readActivitiesExecuteMock,
  }),
  readConversationHistoryRuntimeTool: () => ({
    execute: readConversationHistoryExecuteMock,
  }),
  readRelationshipsRuntimeTool: () => ({
    execute: readRelationshipsExecuteMock,
  }),
  readRelatedObjectsRuntimeTool: () => ({
    execute: readRelatedObjectsExecuteMock,
  }),
  readRelatedObjectContextsRuntimeTool: () => ({
    execute: readRelatedObjectContextsExecuteMock,
  }),
  showImageRuntimeTool: () => ({
    execute: showImageExecuteMock,
  }),
}))

import { executeRoutedSkill } from './skillExecutor.ts'

describe('executeRoutedSkill agent-first execution wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    traceMock.mockResolvedValue(undefined)
    createActivityMock.mockResolvedValue({
      activityId: 'scene-1',
    })
    appendConversationMessageMock.mockResolvedValue(undefined)
    recallMock.mockResolvedValue(null)
    generateHeroMock.mockResolvedValue({
      requestId: 'req-1',
      imageUrl: '/content/conversations/conv-1/generated.jpg',
      heroImageUrl: '/content/conversations/conv-1/generated.jpg',
      summary: 'Yoko zeigt ein neues Bild',
      model: 'flux-2-flex',
      width: 1536,
      height: 1152,
      seed: 123,
    })
    runQuizMock.mockResolvedValue(null)
    resolveCharacterImageRefsMock.mockResolvedValue([
      { kind: 'standard', title: 'Standard', path: '/content/characters/yoko/standard-figur.png' },
    ])
    readActivitiesExecuteMock.mockResolvedValue({
      activityCount: 1,
      hasMore: false,
      nextOffset: 1,
      items: [
        {
          activityId: 'a-1',
          activityType: 'conversation.image.recalled',
          isPublic: true,
          conversationId: 'conv-1',
          occurredAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          objectType: 'image',
          objectId: 'img-1',
          imageRefs: { imageId: 'img-1', imageUrl: '/content/img-1.jpg' },
          summary: 'Eiffelturm Erinnerung',
          metadata: {},
        },
      ],
    })
    readConversationHistoryExecuteMock.mockResolvedValue({
      scope: 'external',
      limit: 200,
      offset: 0,
      conversations: [
        {
          conversationId: 'conv-1',
          characterId: '00000000-0000-4000-8000-000000000001',
          startedAt: new Date().toISOString(),
          messageCount: 1,
          hasMore: false,
          nextOffset: 1,
          messages: [],
          imageCandidates: [
            {
              messageId: 1,
              imageId: 'img-1',
              imageUrl: '/content/img-1.jpg',
              summary: 'Eiffelturm am Fluss',
              source: 'message-metadata',
            },
          ],
        },
      ],
    })
    showImageExecuteMock.mockResolvedValue({
      imageUrl: '/content/img-1.jpg',
      reason: 'query_match',
      sceneSummary: 'Eiffelturm am Fluss',
    })
    readRelatedObjectContextsExecuteMock.mockResolvedValue({
      matchCount: 1,
      relatedCharacterIds: ['8eb40291-65ee-49b6-b826-d7c7e97404c0'],
      matchedContexts: [],
      relatedObjects: [],
    })
    readRelationshipsExecuteMock.mockResolvedValue({
      relationshipCount: 1,
      relatedCharacterIds: ['8eb40291-65ee-49b6-b826-d7c7e97404c0'],
      objectMatchCount: 0,
      relationshipLinks: [
        {
          relatedCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
          direction: 'outgoing',
          relationshipType: 'freundin',
          relationshipTypeReadable: 'Freundin',
          relationship: 'Freundin',
          otherRelatedObjects: [{ type: 'place', id: '00000000-0000-4000-8000-000000000005', label: 'Kristallsee' }],
        },
      ],
    })
    readRelatedObjectsExecuteMock.mockResolvedValue({
      relatedObjectCount: 1,
      relatedObjects: [
        {
          objectType: 'character',
          objectId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
          displayName: 'Nola',
          species: 'Elf',
          shortDescription: 'freundlich',
          relationshipLinks: [
            {
              relatedCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
              direction: 'outgoing',
              relationshipType: 'freundin',
              relationshipTypeReadable: 'Freundin',
              relationship: 'Freundin',
            },
          ],
          imageRefs: [
            { kind: 'standard', title: 'Standard', path: '/content/characters/nola/standard-figur.png' },
          ],
          evidence: [],
        },
      ],
    })
  })

  it('fuehrt bei remember-something das show_image Tool aus', async () => {
    await executeRoutedSkill({
      conversationId: 'conv-1',
      decision: { skillId: 'remember-something', reason: 'memory-image-request' },
      assistantText: 'Ich schaue kurz in unsere Erinnerungen.',
      lastUserText: 'Zeig mir ein Bild aus unserer Erinnerung.',
      characterId: '00000000-0000-4000-8000-000000000001',
      characterName: 'Yoko',
    })

    expect(readActivitiesExecuteMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        scope: 'external',
        limit: 200,
        fetchAll: true,
      }),
    )
    expect(readConversationHistoryExecuteMock).toHaveBeenCalled()
    expect(showImageExecuteMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        source: 'runtime',
        preferredImageUrl: '/content/img-1.jpg',
        preferredImageId: 'img-1',
      }),
    )
    expect(traceMock).toHaveBeenCalledTimes(2)
    expect(traceMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        activityType: 'trace.skill.execution.response',
        output: expect.objectContaining({
          skillId: 'remember-something',
          executedTools: expect.arrayContaining([
            'read_activities',
            'read_conversation_history',
            'show_image',
          ]),
        }),
      }),
    )
  })

  it('fuehrt visuelle Generierung und Quiz bei create_scene aus', async () => {
    await executeRoutedSkill({
      conversationId: 'conv-1',
      decision: { skillId: 'create_scene', reason: 'quiz-request' },
      assistantText: 'Ich zeige dir jetzt eine Szene. Und hier ist eine kleine Frage.',
      lastUserText: 'Bitte Quiz starten.',
      characterId: '00000000-0000-4000-8000-000000000001',
      characterName: 'Yoko',
    })

    expect(readActivitiesExecuteMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ scope: 'external', limit: 200, fetchAll: true }),
    )
    expect(generateHeroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
      }),
    )
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'conversation.scene.directed',
        isPublic: false,
        conversationId: 'conv-1',
      }),
    )
    expect(runQuizMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      userText: 'Bitte Quiz starten.',
      assistantText: 'Ich zeige dir jetzt eine Szene. Und hier ist eine kleine Frage.',
      source: 'runtime',
    })
    expect(traceMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        output: expect.objectContaining({
          executedTools: expect.arrayContaining([
            'read_activities',
            'generate_image',
            'record_scene_activity',
            'run_quiz',
          ]),
        }),
      }),
    )
  })

  it('generiert bei create_scene auch ohne visuelle Marker ein Bild und Scene-Activity', async () => {
    await executeRoutedSkill({
      conversationId: 'conv-2',
      decision: { skillId: 'create_scene', reason: 'action-request' },
      assistantText: 'Ich werde euch helfen.',
      lastUserText: 'Und beschuetzen.',
      characterId: '00000000-0000-4000-8000-000000000007',
      characterName: 'Malvarion der Graue',
    })

    expect(generateHeroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-2',
        characterId: '00000000-0000-4000-8000-000000000007',
      }),
    )
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'conversation.scene.directed',
        isPublic: false,
        characterId: '00000000-0000-4000-8000-000000000007',
        conversationId: 'conv-2',
        metadata: expect.objectContaining({
          summary: expect.any(String),
          nextSceneSummary: expect.any(String),
        }),
      }),
    )
  })

  it('reicht aufgeloeste Related Objects als Grounding in Summary, Prompt und Bildtool weiter', async () => {
    const relationshipContext = {
      relationshipLinks: [
        {
          relatedCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
          direction: 'incoming' as const,
          relationshipType: 'fuerchtet_sich_vor',
          relationshipTypeReadable: 'Hat Angst vor',
          relationship: 'Hat Angst vor',
          description: 'Lorelei fuerchtet Yoko.',
          otherRelatedObjects: [],
        },
      ],
      directRelatedObjects: [
        {
          objectType: 'character',
          objectId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
          displayName: 'Lorelei',
          species: 'Mensch',
          shortDescription: 'wirkt anmutig und vorsichtig',
          relationshipLinks: [
            {
              relatedCharacterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
              direction: 'incoming' as const,
              relationshipType: 'fuerchtet_sich_vor',
              relationshipTypeReadable: 'Hat Angst vor',
              relationship: 'Hat Angst vor',
            },
          ],
          imageRefs: [
            {
              kind: 'standard' as const,
              title: 'Standard',
              path: '/content/characters/lorelei-das-goldmaedchen/standard-figur.png',
            },
          ],
          evidence: ['Hat Angst vor'],
        },
      ],
    }

    await executeRoutedSkill({
      conversationId: 'conv-rel',
      decision: { skillId: 'create_scene', reason: 'action-request' },
      assistantText: 'Ich zeige dir jetzt, wie die Szene aussieht.',
      lastUserText: 'Zeig mir, wie der Charakter, der Angst vor dir hat, vor deinem Haus steht.',
      characterId: '00000000-0000-4000-8000-000000000001',
      characterName: 'Yoko',
      relationshipContext,
    })

    expect(generateHeroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-rel',
        relatedCharacterIds: ['8eb40291-65ee-49b6-b826-d7c7e97404c0'],
        relatedCharacterNames: ['Lorelei'],
        forceReferenceImagePaths: expect.arrayContaining([
          '/content/characters/lorelei-das-goldmaedchen/standard-figur.png',
        ]),
      }),
    )
    expect(createActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'conversation.scene.directed',
        metadata: expect.objectContaining({
          groundedSceneCharacters: expect.arrayContaining([
            expect.objectContaining({
              displayName: 'Lorelei',
              source: 'relationship-name-match',
              evidence: expect.arrayContaining(['Hat Angst vor']),
            }),
          ]),
          imagePrompt: expect.stringContaining('Lorelei'),
          nextSceneSummary: expect.stringContaining('Lorelei'),
        }),
      }),
    )
  })

  it('waehlt fuer Juna Lia das relevante glitzernder-stein-Bild statt latest', async () => {
    readActivitiesExecuteMock.mockResolvedValueOnce({
      activityCount: 2,
      hasMore: false,
      nextOffset: 2,
      items: [
        {
          activityId: 'a-latest',
          activityType: 'conversation.image.recalled',
          isPublic: true,
          conversationId: 'conv-juna-2',
          occurredAt: new Date('2026-03-08T10:00:00.000Z').toISOString(),
          createdAt: new Date('2026-03-08T10:00:00.000Z').toISOString(),
          objectType: 'image',
          objectId: 'img-latest',
          imageRefs: { imageId: 'img-latest', imageUrl: '/content/conversations/x/latest.jpg' },
          summary: 'Juna Lia am Fluss mit Blume',
          metadata: {},
        },
        {
          activityId: 'a-stone',
          activityType: 'conversation.image.generated',
          isPublic: true,
          conversationId: 'conv-juna-1',
          occurredAt: new Date('2026-03-07T10:00:00.000Z').toISOString(),
          createdAt: new Date('2026-03-07T10:00:00.000Z').toISOString(),
          objectType: 'image',
          objectId: 'img-glitzerstein',
          imageRefs: {
            imageId: 'img-glitzerstein',
            imageUrl: '/content/conversations/eval-juna-lia/glitzernder-stein.svg',
          },
          summary: 'Juna Lia findet einen glitzernden Stein am Ufer',
          metadata: {},
        },
      ],
    })
    readConversationHistoryExecuteMock.mockResolvedValueOnce({
      scope: 'external',
      limit: 200,
      offset: 0,
      conversations: [
        {
          conversationId: 'conv-juna-1',
          characterId: '00000000-0000-4000-8000-000000000002',
          startedAt: new Date('2026-03-07T09:30:00.000Z').toISOString(),
          messageCount: 1,
          hasMore: false,
          nextOffset: 1,
          messages: [],
          imageCandidates: [
            {
              messageId: 3,
              imageId: 'img-glitzerstein',
              imageUrl: '/content/conversations/eval-juna-lia/glitzernder-stein.svg',
              summary: 'Juna Lia haelt einen glitzernden Stein in den Haenden',
              source: 'message-metadata',
            },
          ],
        },
      ],
    })

    await executeRoutedSkill({
      conversationId: 'conv-now',
      decision: { skillId: 'remember-something', reason: 'memory-image-request' },
      assistantText: 'Ich schaue kurz nach.',
      lastUserText: 'Findest du ein Bild mit dem glitzernden Stein?',
      characterId: '00000000-0000-4000-8000-000000000002',
      characterName: 'Juna Lia',
    })

    expect(showImageExecuteMock).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        preferredImageId: 'img-glitzerstein',
        preferredImageUrl: '/content/conversations/eval-juna-lia/glitzernder-stein.svg',
        source: 'runtime',
      }),
    )
  })

  it('laedt im Minimal-Flow keine Relationships oder Objektkontexte', async () => {
    await executeRoutedSkill({
      conversationId: 'conv-1',
      decision: { skillId: 'create_scene', reason: 'action-request' },
      assistantText: 'Ich zeige dir jetzt: wir kommen am kristallsee an.',
      lastUserText: 'Gehe zum kristallsee und schau was dort ist.',
      characterId: '00000000-0000-4000-8000-000000000001',
      characterName: 'Yoko',
    })

    expect(readRelationshipsExecuteMock).not.toHaveBeenCalled()
    expect(readRelatedObjectsExecuteMock).not.toHaveBeenCalled()
    expect(readRelatedObjectContextsExecuteMock).not.toHaveBeenCalled()
    expect(generateHeroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        characterId: '00000000-0000-4000-8000-000000000001',
      }),
    )
    const generatedInput = generateHeroMock.mock.calls.at(-1)?.[0]
    expect(generatedInput.relatedCharacterIds).toBeUndefined()
    expect(generatedInput.relatedCharacterNames).toBeUndefined()
  })

  it('reicht nur die letzten zwei Szenenbilder als Pflichtreferenzen weiter und baut den Summary-first Prompt', async () => {
    readActivitiesExecuteMock.mockResolvedValueOnce({
      activityCount: 4,
      hasMore: false,
      nextOffset: 4,
      items: [
        {
          activityId: 'a-context',
          activityType: 'conversation.summary.updated',
          isPublic: true,
          conversationId: 'conv-std',
          occurredAt: new Date('2026-03-08T08:00:00.000Z').toISOString(),
          createdAt: new Date('2026-03-08T08:00:00.000Z').toISOString(),
          imageRefs: {},
          summary: 'Yoko begruesst die Kinder im Morgenlicht.',
          metadata: {},
        },
        {
          activityId: 'a-older-scene',
          activityType: 'conversation.image.generated',
          isPublic: true,
          conversationId: 'conv-std',
          occurredAt: new Date('2026-03-08T09:00:00.000Z').toISOString(),
          createdAt: new Date('2026-03-08T09:00:00.000Z').toISOString(),
          objectType: 'image',
          objectId: 'img-older',
          imageRefs: { imageId: 'img-older', imageUrl: '/content/conversations/conv-std/older.jpg' },
          summary: 'Yoko lief ueber die Bruecke.',
          metadata: {},
        },
        {
          activityId: 'a-previous',
          activityType: 'conversation.image.generated',
          isPublic: true,
          conversationId: 'conv-std',
          occurredAt: new Date('2026-03-08T10:00:00.000Z').toISOString(),
          createdAt: new Date('2026-03-08T10:00:00.000Z').toISOString(),
          objectType: 'image',
          objectId: 'img-previous',
          imageRefs: { imageId: 'img-previous', imageUrl: '/content/conversations/conv-std/previous.jpg' },
          storySummary: 'Yoko entdeckte eine weiche Kissenburg.',
          summary: 'Yoko zeigt die Kissenburg.',
          metadata: {},
        },
        {
          activityId: 'a-latest',
          activityType: 'conversation.image.recalled',
          isPublic: true,
          conversationId: 'conv-std',
          occurredAt: new Date('2026-03-08T11:00:00.000Z').toISOString(),
          createdAt: new Date('2026-03-08T11:00:00.000Z').toISOString(),
          objectType: 'image',
          objectId: 'img-latest',
          imageRefs: { imageId: 'img-latest', imageUrl: '/content/conversations/conv-std/latest.jpg' },
          storySummary: 'Yoko sprang lachend in die Kissenburg.',
          summary: 'Yoko springt in die Kissenburg.',
          metadata: {},
        },
      ],
    })

    await executeRoutedSkill({
      conversationId: 'conv-std',
      decision: { skillId: 'create_scene', reason: 'action-request' },
      assistantText: 'Ich zeige dir jetzt: wir besuchen den kristallsee.',
      lastUserText: 'Zeig mir, wie es in der Kissenburg weitergeht.',
      characterId: '00000000-0000-4000-8000-000000000001',
      characterName: 'Yoko',
    })

    expect(generateHeroMock).toHaveBeenCalledWith(
      expect.objectContaining({
        forceReferenceImagePaths: [
          '/content/conversations/conv-std/previous.jpg',
          '/content/conversations/conv-std/latest.jpg',
        ],
      }),
    )
    const generatedInput = generateHeroMock.mock.calls.at(-1)?.[0]
    expect(generatedInput.sceneSummary).toContain('Kissenburg')
    expect(generatedInput.imagePrompt).toContain('Kissenburg')
    expect(generatedInput.imagePrompt).not.toContain('NEXT SCENE IMAGE BRIEF')
    expect(generatedInput.imagePrompt).not.toContain('SCENE TO RENDER:')
    expect(generatedInput.imagePrompt).not.toContain('VISUAL CONTINUITY:')
  })

  it('gibt bei fehlender Szenen-Summary-LLM einen mueden Fehlertext statt einer kaputten Szene aus', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    try {
      await executeRoutedSkill({
        conversationId: 'conv-err',
        decision: { skillId: 'create_scene', reason: 'action-request' },
        assistantText: 'Ich klettere mit dir auf den Baum.',
        lastUserText: 'Kannst du da hinten den Baum hochklettern?',
        characterId: '00000000-0000-4000-8000-000000000001',
        characterName: 'Yoko',
      })
    } finally {
      if (originalApiKey == null) {
        delete process.env.OPENAI_API_KEY
      } else {
        process.env.OPENAI_API_KEY = originalApiKey
      }
    }

    expect(generateHeroMock).not.toHaveBeenCalled()
    expect(createActivityMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        activityType: 'conversation.scene.directed',
      }),
    )
    expect(appendConversationMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-err',
        role: 'assistant',
        eventType: 'runtime.skill.unavailable',
        content:
          'Ich bin aktuell leider sehr muede und kann nicht helfen. Probiere es ein bisschen spaeter noch einmal.',
      }),
    )
    expect(traceMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        activityType: 'trace.skill.execution.response',
        ok: false,
        error: 'next-scene-summary-unavailable:missing-openai-api-key',
      }),
    )
  })
})
