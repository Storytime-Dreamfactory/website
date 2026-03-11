import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getOpenAiApiKeyMock = vi.hoisted(() => vi.fn())
const readServerEnvMock = vi.hoisted(() => vi.fn((_name: string, fallback: string) => fallback))
const readFileMock = vi.hoisted(() => vi.fn())

vi.mock('../../openAiConfig.ts', () => ({
  getOpenAiApiKey: getOpenAiApiKeyMock,
  readServerEnv: readServerEnvMock,
}))

vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
}))

import {
  buildPublicActivityStream,
  generateImagePromptFromSceneSummary,
  generateNextSceneSummary,
  selectGroundedSceneCharacters,
} from './createSceneBuilder.ts'

describe('createSceneBuilder', () => {
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    vi.clearAllMocks()
    getOpenAiApiKeyMock.mockReturnValue('test-openai-key')
    readFileMock.mockResolvedValue(Buffer.from('fake-image-binary'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalNodeEnv == null) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
  })

  it('erzeugt den Bildprompt als freien LLM-Text', async () => {
    process.env.NODE_ENV = 'development'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          output_text:
            'A warm fairy-tale scene of Yoko discovering a shimmering path behind the house, continuing the mood and lighting of the last two scenes.',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)
    const entries = buildPublicActivityStream([
      {
        activityType: 'conversation.summary.updated',
        occurredAt: '2026-03-09T10:00:00.000Z',
        createdAt: '2026-03-09T10:00:00.000Z',
        summary: 'Yoko winkt den Kindern zu.',
        imageRefs: {},
      },
      {
        activityType: 'conversation.image.generated',
        occurredAt: '2026-03-09T11:00:00.000Z',
        createdAt: '2026-03-09T11:00:00.000Z',
        storySummary: 'Yoko springt ueber einen Bach.',
        imageRefs: { imageUrl: '/content/conversations/conv-1/scene.jpg' },
      },
    ])

    const prompt = await generateImagePromptFromSceneSummary({
      characterName: 'Yoko',
      userRequest: 'Zeig mir, wie es weitergeht.',
      sceneSummary: 'Danach war zu sehen, wie Yoko einen glitzernden Pfad entdeckte.',
      history: {
        allSummaries: [
          { timestamp: '2026-03-09T11:00:00.000Z', summary: 'Yoko springt ueber einen Bach.' },
        ],
        whatHappenedSoFar: [],
        previousScene: {
          timestamp: '2026-03-09T11:00:00.000Z',
          summary: 'Yoko springt ueber einen Bach.',
          imageUrl: '/content/conversations/conv-1/scene.jpg',
        },
        latestScene: {
          timestamp: '2026-03-09T12:00:00.000Z',
          summary: 'Yoko landet lachend auf der anderen Seite.',
          imageUrl: '/content/conversations/conv-1/scene-2.jpg',
        },
      },
      publicActivityStream: entries,
    })

    expect(entries).toHaveLength(2)
    expect(prompt).toContain('Yoko discovering a shimmering path')
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(request.input[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input_text',
          text: expect.stringContaining('SCENE SUMMARY:'),
        }),
        expect.objectContaining({
          type: 'input_text',
          text: expect.stringContaining('FULL PUBLIC ACTIVITY STREAM:'),
        }),
      ]),
    )
  })

  it('erzeugt die Summary multimodal mit den letzten zwei Szenenbildern', async () => {
    process.env.NODE_ENV = 'development'
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: 'Danach war zu sehen, wie Yoko einen hellen Pfad entlanglief.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const publicActivityStream = buildPublicActivityStream([
      {
        activityType: 'conversation.summary.updated',
        occurredAt: '2026-03-09T10:00:00.000Z',
        createdAt: '2026-03-09T10:00:00.000Z',
        summary: 'Yoko winkt den Kindern zu.',
        imageRefs: {},
      },
    ])

    const summary = await generateNextSceneSummary({
      characterName: 'Yoko',
      userRequest: 'Zeig mir den Weg hinter dem Haus.',
      assistantText: 'Ich zeige dir jetzt den Weg.',
      history: {
        allSummaries: [],
        whatHappenedSoFar: [
          { timestamp: '2026-03-09T09:00:00.000Z', summary: 'Yoko lief durch den Wald.' },
        ],
        previousScene: {
          timestamp: '2026-03-09T10:00:00.000Z',
          summary: 'Yoko steht am Gartenzaun.',
          imageUrl: '/content/conversations/conv-1/previous.jpg',
        },
        latestScene: {
          timestamp: '2026-03-09T11:00:00.000Z',
          summary: 'Yoko blickt hinter das Haus.',
          imageUrl: '/content/conversations/conv-1/latest.jpg',
        },
      },
      publicActivityStream,
    })

    expect(summary).toBe('Danach war zu sehen, wie Yoko einen hellen Pfad entlanglief.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.openai.com/v1/responses')
    expect(request.input[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'input_text' }),
        expect.objectContaining({
          type: 'input_text',
          text: expect.stringContaining('SCENE BEFORE THAT'),
        }),
        expect.objectContaining({
          type: 'input_text',
          text: expect.stringContaining('LAST SCENE'),
        }),
        expect.objectContaining({
          type: 'input_image',
          image_url: expect.stringContaining('data:image/jpeg;base64,'),
        }),
      ]),
    )
    expect(request.input[0].content.filter((item: { type: string }) => item.type === 'input_image')).toHaveLength(2)
  })

  it('erdet relationale Figuren wie "der Charakter, der Angst vor dir hat" ueber directRelatedObjects', () => {
    const groundedCharacters = selectGroundedSceneCharacters({
      mainCharacterId: 'agatha',
      mainCharacterName: 'Agatha',
      mainCharacterImageRefs: [
        { kind: 'standard', title: 'Standard', path: '/content/characters/agatha/standard-figur.png' },
      ],
      userRequest: 'Zeig mir, wie der Charakter, der Angst vor dir hat, vor deinem Haus steht.',
      nextSceneSummary: 'Lorelei hatte zitternd vor Agathas Haus gestanden.',
      directRelatedObjects: [
        {
          objectType: 'character',
          objectId: 'lorelei',
          displayName: 'Lorelei',
          species: 'Mensch',
          shortDescription: 'anmutig und vorsichtig',
          relationshipLinks: [
            {
              relatedCharacterId: 'lorelei',
              direction: 'incoming',
              relationshipType: 'fuerchtet_sich_vor',
              relationshipTypeReadable: 'Hat Angst vor',
              relationship: 'Hat Angst vor',
            },
          ],
          imageRefs: [
            {
              kind: 'standard',
              title: 'Standard',
              path: '/content/characters/lorelei/standard-figur.png',
            },
          ],
          evidence: ['Hat Angst vor'],
        },
      ],
      contextualRelatedObjects: [],
    })

    expect(groundedCharacters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          characterId: 'agatha',
          source: 'active-character',
        }),
        expect.objectContaining({
          characterId: 'lorelei',
          displayName: 'Lorelei',
          source: 'relationship-name-match',
          evidence: expect.arrayContaining(['Hat Angst vor']),
          standardImagePath: '/content/characters/lorelei/standard-figur.png',
        }),
      ]),
    )
  })

  it('gibt grounded scene characters in Summary- und Prompt-LLM-Kontext weiter', async () => {
    process.env.NODE_ENV = 'development'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: 'Lorelei hatte zitternd vor dem Haus gestanden.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ output_text: 'Lorelei stands nervously before the warm-lit house.' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const groundedSceneCharacters = [
      {
        characterId: 'agatha',
        displayName: 'Agatha',
        source: 'active-character' as const,
        evidence: [],
        standardImagePath: '/content/characters/agatha/standard-figur.png',
      },
      {
        characterId: 'lorelei',
        displayName: 'Lorelei',
        source: 'relationship-name-match' as const,
        evidence: ['Hat Angst vor'],
        standardImagePath: '/content/characters/lorelei/standard-figur.png',
      },
    ]

    const baseInput = {
      characterName: 'Agatha',
      userRequest: 'Zeig mir, wie der Charakter, der Angst vor dir hat, vor deinem Haus steht.',
      history: {
        allSummaries: [],
        whatHappenedSoFar: [],
        previousScene: null,
        latestScene: null,
      },
      publicActivityStream: [] as ReturnType<typeof buildPublicActivityStream>,
      groundedSceneCharacters,
    }

    await generateNextSceneSummary({
      ...baseInput,
      assistantText: 'Ich zeige dir die Szene.',
    })

    await generateImagePromptFromSceneSummary({
      ...baseInput,
      sceneSummary: 'Lorelei hatte zitternd vor dem Haus gestanden.',
    })

    const summaryRequest = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    const promptRequest = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(summaryRequest.input[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input_text',
          text: expect.stringContaining('GROUNDED SCENE CHARACTERS:'),
        }),
        expect.objectContaining({
          type: 'input_text',
          text: expect.stringContaining('Lorelei'),
        }),
      ]),
    )
    expect(promptRequest.input[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'input_text',
          text: expect.stringContaining('GROUNDED SCENE CHARACTERS:'),
        }),
        expect.objectContaining({
          type: 'input_text',
          text: expect.stringContaining('Hat Angst vor'),
        }),
      ]),
    )
  })
})
