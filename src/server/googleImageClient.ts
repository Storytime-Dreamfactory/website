import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { GoogleImageModel } from './imageModelSupport.ts'

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'

type GoogleGenerateContentResponse = {
  responseId?: string
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string
        inlineData?: {
          mimeType?: string
          data?: string
        }
        inline_data?: {
          mime_type?: string
          data?: string
        }
      }>
    }
    finishReason?: string
  }>
  promptFeedback?: {
    blockReason?: string
  }
}

type GoogleInlineData =
  | {
      mimeType?: string
      data?: string
    }
  | {
      mime_type?: string
      data?: string
    }

const guessMimeType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

const toInlineDataPart = async (
  filePath: string,
): Promise<{ inlineData: { mimeType: string; data: string } }> => {
  const fileBuffer = await readFile(filePath)
  return {
    inlineData: {
      mimeType: guessMimeType(filePath),
      data: fileBuffer.toString('base64'),
    },
  }
}

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text()

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const buildPrompt = (input: {
  prompt: string
  width: number
  height: number
  outputFormat: 'png' | 'jpeg'
}): string =>
  [
    input.prompt.trim(),
    '',
    `Technische Zielvorgabe: Komposition fuer ${input.width}x${input.height}px.`,
    `Bevorzugtes Ausgabeformat: ${input.outputFormat.toUpperCase()}.`,
  ].join('\n')

const getInlineDataMimeType = (inlineData: GoogleInlineData | undefined): string | undefined => {
  if (!inlineData) return undefined
  if ('mimeType' in inlineData) return inlineData.mimeType
  if ('mime_type' in inlineData) return inlineData.mime_type
  return undefined
}

export class GoogleImageClient {
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async generateImage(input: {
    model: GoogleImageModel
    prompt: string
    width: number
    height: number
    outputFormat: 'png' | 'jpeg'
    referenceImagePaths?: string[]
  }): Promise<{ id: string; imageUrl: string; mimeType: string }> {
    const imageParts = await Promise.all((input.referenceImagePaths ?? []).map((filePath) => toInlineDataPart(filePath)))
    const response = await fetch(`${API_ROOT}/${input.model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildPrompt({
                  prompt: input.prompt,
                  width: input.width,
                  height: input.height,
                  outputFormat: input.outputFormat,
                }),
              },
              ...imageParts,
            ],
          },
        ],
        generationConfig: {
          responseModalities: ['IMAGE'],
        },
      }),
    })

    if (!response.ok) {
      const errorBody = await parseResponseBody(response)
      throw new Error(`Gemini request failed (${response.status}): ${JSON.stringify(errorBody)}`)
    }

    const payload = (await response.json()) as GoogleGenerateContentResponse
    const imagePart = payload.candidates
      ?.flatMap((candidate) => candidate.content?.parts ?? [])
      .find((part) => {
        const inlineData = part.inlineData ?? part.inline_data
        return Boolean(inlineData?.data)
      })

    const inlineData = imagePart?.inlineData ?? imagePart?.inline_data
    const mimeType = getInlineDataMimeType(inlineData) ?? 'image/png'
    const base64Data = inlineData?.data

    if (!base64Data) {
      const textResponse = payload.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text?.trim() ?? '')
        .filter((part) => part.length > 0)
        .join('\n')
      const blockReason = payload.promptFeedback?.blockReason
      throw new Error(
        textResponse || blockReason
          ? `Gemini returned no image data: ${textResponse || blockReason}`
          : 'Gemini returned no image data.',
      )
    }

    return {
      id: payload.responseId?.trim() || randomUUID(),
      imageUrl: `data:${mimeType};base64,${base64Data}`,
      mimeType,
    }
  }
}
