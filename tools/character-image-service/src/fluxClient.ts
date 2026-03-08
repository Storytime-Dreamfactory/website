import { readFile } from 'node:fs/promises'
import type { FluxCreateResponse, FluxModel, FluxPollResult } from './types.ts'

const API_ROOT = 'https://api.bfl.ai/v1'
const MAX_REFERENCE_IMAGES = 8

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const toBase64 = async (filePath: string): Promise<string> => {
  const fileBuffer = await readFile(filePath)
  return fileBuffer.toString('base64')
}

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text()

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export class FluxClient {
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async post(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<FluxCreateResponse> {
    const response = await fetch(`${API_ROOT}/${endpoint}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-key': this.apiKey,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorBody = await parseResponseBody(response)
      throw new Error(`FLUX request failed (${response.status}): ${JSON.stringify(errorBody)}`)
    }

    return (await response.json()) as FluxCreateResponse
  }

  async generateTextToImage(input: {
    model: FluxModel
    prompt: string
    width: number
    height: number
    outputFormat: 'png' | 'jpeg'
    seed: number
    safetyTolerance?: number
  }): Promise<FluxCreateResponse> {
    return this.post(input.model, {
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      output_format: input.outputFormat,
      seed: input.seed,
      safety_tolerance: input.safetyTolerance ?? 2,
    })
  }

  async editImage(input: {
    model: FluxModel
    prompt: string
    width: number
    height: number
    outputFormat: 'png' | 'jpeg'
    seed: number
    referenceImagePaths: string[]
    safetyTolerance?: number
  }): Promise<FluxCreateResponse> {
    if (input.referenceImagePaths.length === 0) {
      throw new Error('FLUX image editing requires at least one reference image')
    }

    const limitedReferencePaths = input.referenceImagePaths.slice(0, MAX_REFERENCE_IMAGES)
    const encodedImages = await Promise.all(limitedReferencePaths.map((filePath) => toBase64(filePath)))

    const imagePayload = encodedImages.reduce<Record<string, string>>((payload, image, index) => {
      const key = index === 0 ? 'input_image' : `input_image_${index + 1}`
      payload[key] = image
      return payload
    }, {})

    return this.post(input.model, {
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      output_format: input.outputFormat,
      seed: input.seed,
      safety_tolerance: input.safetyTolerance ?? 2,
      ...imagePayload,
    })
  }

  async pollResult(input: {
    pollingUrl: string
    pollIntervalMs: number
    maxAttempts: number
  }): Promise<FluxPollResult> {
    for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
      const response = await fetch(input.pollingUrl, {
        headers: {
          accept: 'application/json',
          'x-key': this.apiKey,
        },
      })

      if (!response.ok) {
        const errorBody = await parseResponseBody(response)
        throw new Error(`FLUX polling failed (${response.status}): ${JSON.stringify(errorBody)}`)
      }

      const result = (await response.json()) as FluxPollResult
      if (result.status === 'Ready' || result.status === 'Error' || result.status === 'Failed') {
        return result
      }

      await sleep(input.pollIntervalMs)
    }

    throw new Error(`FLUX polling timed out after ${input.maxAttempts} attempts`)
  }
}
