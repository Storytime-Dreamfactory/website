import { readFile } from 'node:fs/promises'
import type { FluxCreateResponse, FluxModel, FluxPollResult } from './types.ts'

const API_ROOT = 'https://api.bfl.ai/v1'
const MAX_REFERENCE_IMAGES = 8
const FETCH_ERROR_MESSAGE_MAX_LENGTH = 160

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

const readCauseCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined
  const cause = 'cause' in error ? (error as { cause?: unknown }).cause : undefined
  if (!cause || typeof cause !== 'object') return undefined
  const code = 'code' in cause ? (cause as { code?: unknown }).code : undefined
  return typeof code === 'string' && code.trim().length > 0 ? code.trim() : undefined
}

const classifyFetchFailure = (code: string | undefined, message: string): string => {
  const normalizedCode = (code ?? '').toUpperCase()
  const normalizedMessage = message.toLowerCase()
  if (
    normalizedCode === 'ENOTFOUND' ||
    normalizedCode === 'EAI_AGAIN' ||
    normalizedMessage.includes('getaddrinfo')
  ) {
    return 'dns'
  }
  if (
    normalizedCode === 'ETIMEDOUT' ||
    normalizedCode === 'ABORT_ERR' ||
    normalizedCode.includes('TIMEOUT') ||
    normalizedMessage.includes('timed out')
  ) {
    return 'timeout'
  }
  if (
    normalizedCode.includes('CERT') ||
    normalizedCode.includes('TLS') ||
    normalizedMessage.includes('certificate') ||
    normalizedMessage.includes('tls')
  ) {
    return 'tls'
  }
  if (
    normalizedCode === 'ECONNRESET' ||
    normalizedCode === 'ECONNREFUSED' ||
    normalizedCode === 'EHOSTUNREACH' ||
    normalizedCode === 'ENETUNREACH'
  ) {
    return 'network'
  }
  return 'unknown'
}

const compactFetchErrorMessage = (prefix: string, error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error)
  const code = readCauseCode(error)
  const reason = classifyFetchFailure(code, message)
  const compactMessage =
    message.length > FETCH_ERROR_MESSAGE_MAX_LENGTH
      ? `${message.slice(0, FETCH_ERROR_MESSAGE_MAX_LENGTH)}...`
      : message
  const parts = [
    prefix,
    'fetch-failed',
    `reason=${reason}`,
    code ? `code=${code}` : '',
    `message=${compactMessage}`,
  ].filter((item) => item.length > 0)
  return parts.join(':')
}

const formatPollContext = (input: {
  pollingUrl: string
  maxAttempts: number
  pollIntervalMs: number
  attempt: number
  lastStatus?: string
}): string =>
  [
    `pollingUrl=${input.pollingUrl}`,
    `attempt=${input.attempt}/${input.maxAttempts}`,
    `pollIntervalMs=${input.pollIntervalMs}`,
    input.lastStatus ? `lastStatus=${input.lastStatus}` : '',
  ]
    .filter((item) => item.length > 0)
    .join(', ')

export class FluxClient {
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async post(
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<FluxCreateResponse> {
    let response: Response
    try {
      response = await fetch(`${API_ROOT}/${endpoint}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-key': this.apiKey,
        },
        body: JSON.stringify(body),
      })
    } catch (fetchError) {
      throw new Error(compactFetchErrorMessage('FLUX request failed', fetchError))
    }

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
    let lastStatus: string | undefined
    for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
      const attemptNumber = attempt + 1
      let response: Response
      try {
        response = await fetch(input.pollingUrl, {
          headers: {
            accept: 'application/json',
            'x-key': this.apiKey,
          },
        })
      } catch (fetchError) {
        const compact = compactFetchErrorMessage('FLUX polling failed', fetchError)
        throw new Error(`${compact}; ${formatPollContext({
          pollingUrl: input.pollingUrl,
          maxAttempts: input.maxAttempts,
          pollIntervalMs: input.pollIntervalMs,
          attempt: attemptNumber,
          lastStatus,
        })}`)
      }

      if (!response.ok) {
        const errorBody = await parseResponseBody(response)
        throw new Error(
          `FLUX polling failed (${response.status}): ${JSON.stringify(errorBody)}; ${formatPollContext({
            pollingUrl: input.pollingUrl,
            maxAttempts: input.maxAttempts,
            pollIntervalMs: input.pollIntervalMs,
            attempt: attemptNumber,
            lastStatus,
          })}`,
        )
      }

      const result = (await response.json()) as FluxPollResult
      lastStatus = result.status
      if (result.status === 'Ready' || result.status === 'Error' || result.status === 'Failed') {
        return result
      }

      await sleep(input.pollIntervalMs)
    }

    throw new Error(
      `FLUX polling timed out after ${input.maxAttempts} attempts; ${formatPollContext({
        pollingUrl: input.pollingUrl,
        maxAttempts: input.maxAttempts,
        pollIntervalMs: input.pollIntervalMs,
        attempt: input.maxAttempts,
        lastStatus,
      })}`,
    )
  }
}
