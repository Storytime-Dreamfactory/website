import { FluxClient } from '../../tools/character-image-service/src/fluxClient.ts'
import { GoogleImageClient } from './googleImageClient.ts'
import { OpenAiImageClient } from './openAiImageClient.ts'
import {
  isFluxModel,
  isGoogleImageModel,
  isOpenAiImageModel,
  parseSupportedImageModel,
  type SupportedImageModel,
} from './imageModelSupport.ts'

const DEFAULT_CONVERSATION_IMAGE_MODEL: SupportedImageModel = 'flux-2-pro'

const outputFormatFromMimeType = (mimeType: string | undefined): 'png' | 'jpeg' => {
  const normalized = (mimeType ?? '').toLowerCase()
  return normalized.includes('png') ? 'png' : 'jpeg'
}

export const resolveDefaultConversationImageModel = (): SupportedImageModel =>
  parseSupportedImageModel(process.env.CONVERSATION_IMAGE_MODEL, DEFAULT_CONVERSATION_IMAGE_MODEL)

export const generateImageWithModel = async (input: {
  model: SupportedImageModel
  prompt: string
  width: number
  height: number
  outputFormat: 'png' | 'jpeg'
  seed: number
  pollIntervalMs: number
  maxPollAttempts: number
  referenceImagePaths?: string[]
}): Promise<{
  requestId: string
  imageUrl: string
  outputFormat: 'png' | 'jpeg'
  cost?: number
}> => {
  if (isFluxModel(input.model)) {
    const apiKey = process.env.BFL_API_KEY?.trim()
    if (!apiKey) {
      throw new Error('BFL_API_KEY fehlt. Bitte setze den FLUX API Key in der Umgebung.')
    }

    const client = new FluxClient(apiKey)
    const requestResult =
      input.referenceImagePaths && input.referenceImagePaths.length > 0
        ? await client.editImage({
            model: input.model,
            prompt: input.prompt,
            width: input.width,
            height: input.height,
            outputFormat: input.outputFormat,
            seed: input.seed,
            referenceImagePaths: input.referenceImagePaths,
          })
        : await client.generateTextToImage({
            model: input.model,
            prompt: input.prompt,
            width: input.width,
            height: input.height,
            outputFormat: input.outputFormat,
            seed: input.seed,
          })

    const pollResult = await client.pollResult({
      pollingUrl: requestResult.polling_url,
      pollIntervalMs: input.pollIntervalMs,
      maxAttempts: input.maxPollAttempts,
    })

    if (pollResult.status !== 'Ready') {
      const errorMessage = 'error' in pollResult ? pollResult.error : undefined
      throw new Error(errorMessage ?? 'FLUX konnte kein Bild erzeugen.')
    }

    return {
      requestId: requestResult.id,
      imageUrl: pollResult.result.sample,
      outputFormat: input.outputFormat,
      cost: requestResult.cost,
    }
  }

  if (isGoogleImageModel(input.model)) {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY?.trim()
    if (!apiKey) {
      throw new Error(
        'GOOGLE_GEMINI_API_KEY fehlt. Bitte setze den Google Gemini API Key in der Umgebung.',
      )
    }

    const client = new GoogleImageClient(apiKey)
    const result = await client.generateImage({
      model: input.model,
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      outputFormat: input.outputFormat,
      referenceImagePaths: input.referenceImagePaths,
    })

    return {
      requestId: result.id,
      imageUrl: result.imageUrl,
      outputFormat: outputFormatFromMimeType(result.mimeType),
    }
  }

  if (isOpenAiImageModel(input.model)) {
    const apiKey = process.env.OPENAI_API_KEY?.trim()
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY fehlt. Bitte setze den OpenAI API Key in der Umgebung.')
    }

    const client = new OpenAiImageClient(apiKey)
    const result = await client.generateImage({
      model: input.model,
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      outputFormat: input.outputFormat,
      referenceImagePaths: input.referenceImagePaths,
    })

    return {
      requestId: result.id,
      imageUrl: result.imageUrl,
      outputFormat: outputFormatFromMimeType(result.mimeType),
    }
  }

  throw new Error(`Unsupported image model: ${input.model}`)
}
