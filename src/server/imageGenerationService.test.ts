import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fluxGenerateTextToImageMock: vi.fn(),
  fluxEditImageMock: vi.fn(),
  fluxPollResultMock: vi.fn(),
  googleGenerateImageMock: vi.fn(),
  openAiGenerateImageMock: vi.fn(),
}))

vi.mock('../../tools/character-image-service/src/fluxClient.ts', () => ({
  FluxClient: class {
    generateTextToImage = mocks.fluxGenerateTextToImageMock
    editImage = mocks.fluxEditImageMock
    pollResult = mocks.fluxPollResultMock
  },
}))

vi.mock('./googleImageClient.ts', () => ({
  GoogleImageClient: class {
    generateImage = mocks.googleGenerateImageMock
  },
}))

vi.mock('./openAiImageClient.ts', () => ({
  OpenAiImageClient: class {
    generateImage = mocks.openAiGenerateImageMock
  },
}))

import { generateImageWithModel, resolveDefaultConversationImageModel } from './imageGenerationService.ts'

describe('imageGenerationService', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('nutzt standardmaessig flux-2-pro fuer Conversation-Bilder', () => {
    expect(resolveDefaultConversationImageModel()).toBe('flux-2-pro')
  })

  it('routet OpenAI-Bildmodelle ueber den OpenAI-Client', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    mocks.openAiGenerateImageMock.mockResolvedValue({
      id: 'openai-request-1',
      imageUrl: 'data:image/png;base64,abc123',
      mimeType: 'image/png',
    })

    const result = await generateImageWithModel({
      model: 'chatgpt-image-latest',
      prompt: 'Eine freundliche Waldszene',
      width: 1024,
      height: 1024,
      outputFormat: 'png',
      seed: 123,
      pollIntervalMs: 1_000,
      maxPollAttempts: 10,
      referenceImagePaths: ['/tmp/reference.png'],
    })

    expect(mocks.openAiGenerateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'chatgpt-image-latest',
        prompt: 'Eine freundliche Waldszene',
        width: 1024,
        height: 1024,
        outputFormat: 'png',
        referenceImagePaths: ['/tmp/reference.png'],
      }),
    )
    expect(result).toEqual({
      requestId: 'openai-request-1',
      imageUrl: 'data:image/png;base64,abc123',
      outputFormat: 'png',
    })
  })

  it('meldet fehlenden OpenAI-Key klar', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')

    await expect(
      generateImageWithModel({
        model: 'gpt-image-1.5',
        prompt: 'Eine neugierige Eule',
        width: 1024,
        height: 1024,
        outputFormat: 'jpeg',
        seed: 123,
        pollIntervalMs: 1_000,
        maxPollAttempts: 10,
      }),
    ).rejects.toThrowError('OPENAI_API_KEY fehlt. Bitte setze den OpenAI API Key in der Umgebung.')
  })
})
