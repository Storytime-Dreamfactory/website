import type { FluxModel } from '../../tools/character-image-service/src/types.ts'

export type GoogleImageModel = 'gemini-2.5-flash-image' | 'gemini-3.1-flash-image'
export type OpenAiImageModel =
  | 'gpt-image-1'
  | 'gpt-image-1-mini'
  | 'gpt-image-1.5'
  | 'chatgpt-image-latest'

export type SupportedImageModel = FluxModel | GoogleImageModel | OpenAiImageModel

export const IMAGE_MODEL_ALIASES = {
  mini: 'flux-2-klein-4b',
  banana: 'gemini-2.5-flash-image',
  openai: 'gpt-image-1.5',
  chatgpt: 'chatgpt-image-latest',
} as const

export type SupportedImageModelAlias = keyof typeof IMAGE_MODEL_ALIASES

export const FLUX_MODELS: FluxModel[] = [
  'flux-2-flex',
  'flux-2-pro-preview',
  'flux-2-pro',
  'flux-2-max',
  'flux-2-klein-4b',
  'flux-2-klein-9b',
]

export const GOOGLE_IMAGE_MODELS: GoogleImageModel[] = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image',
]

export const OPENAI_IMAGE_MODELS: OpenAiImageModel[] = [
  'gpt-image-1',
  'gpt-image-1-mini',
  'gpt-image-1.5',
  'chatgpt-image-latest',
]

export const SUPPORTED_IMAGE_MODELS: SupportedImageModel[] = [
  ...FLUX_MODELS,
  ...GOOGLE_IMAGE_MODELS,
  ...OPENAI_IMAGE_MODELS,
]

export const DEFAULT_IMAGE_MODEL: SupportedImageModel = 'flux-2-klein-4b'

export const isFluxModel = (value: string): value is FluxModel =>
  FLUX_MODELS.includes(value as FluxModel)

export const isGoogleImageModel = (value: string): value is GoogleImageModel =>
  GOOGLE_IMAGE_MODELS.includes(value as GoogleImageModel)

export const isOpenAiImageModel = (value: string): value is OpenAiImageModel =>
  OPENAI_IMAGE_MODELS.includes(value as OpenAiImageModel)

export const resolveSupportedImageModelAlias = (value: string): SupportedImageModel | null => {
  const normalized = value.trim().toLowerCase()
  return IMAGE_MODEL_ALIASES[normalized as SupportedImageModelAlias] ?? null
}

export const parseSupportedImageModel = (
  value: unknown,
  fallback: SupportedImageModel = DEFAULT_IMAGE_MODEL,
): SupportedImageModel => {
  if (typeof value === 'string') {
    const normalized = value.trim()
    const aliased = resolveSupportedImageModelAlias(normalized)
    if (aliased) return aliased
    if (isFluxModel(normalized) || isGoogleImageModel(normalized) || isOpenAiImageModel(normalized)) {
      return normalized
    }
  }

  return fallback
}
