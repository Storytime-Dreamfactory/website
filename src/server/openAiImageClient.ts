import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import OpenAI, { toFile } from 'openai'
import type { OpenAiImageModel } from './imageModelSupport.ts'

const guessMimeType = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.png') return 'image/png'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return 'application/octet-stream'
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

const resolveOpenAiSize = (width: number, height: number): '1024x1024' | '1024x1536' | '1536x1024' => {
  if (width === height) return '1024x1024'
  return width > height ? '1536x1024' : '1024x1536'
}

const toUploadableFile = async (filePath: string): Promise<File> => {
  const fileBuffer = await readFile(filePath)
  return toFile(fileBuffer, path.basename(filePath), { type: guessMimeType(filePath) })
}

export class OpenAiImageClient {
  private readonly client: OpenAI

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey })
  }

  async generateImage(input: {
    model: OpenAiImageModel
    prompt: string
    width: number
    height: number
    outputFormat: 'png' | 'jpeg'
    referenceImagePaths?: string[]
  }): Promise<{ id: string; imageUrl: string; mimeType: string }> {
    const prompt = buildPrompt(input)
    const size = resolveOpenAiSize(input.width, input.height)
    const imageFiles = await Promise.all((input.referenceImagePaths ?? []).map((filePath) => toUploadableFile(filePath)))

    const response =
      imageFiles.length > 0
        ? await this.client.images.edit({
            model: input.model,
            image: imageFiles,
            prompt,
            size,
            quality: 'high',
            input_fidelity: 'high',
            output_format: input.outputFormat,
          })
        : await this.client.images.generate({
            model: input.model,
            prompt,
            size,
            quality: 'high',
            output_format: input.outputFormat,
          })

    const image = response.data?.find((item) => typeof item.b64_json === 'string' && item.b64_json.length > 0)
    const base64Data = image?.b64_json
    if (!base64Data) {
      throw new Error('OpenAI returned no image data.')
    }

    const outputFormat = response.output_format ?? input.outputFormat
    const mimeType = outputFormat === 'png' ? 'image/png' : outputFormat === 'webp' ? 'image/webp' : 'image/jpeg'

    return {
      id: randomUUID(),
      imageUrl: `data:${mimeType};base64,${base64Data}`,
      mimeType,
    }
  }
}
