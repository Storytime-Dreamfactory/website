import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type StoredConversationImageAsset = {
  localUrl: string
  localFilePath: string
  originalUrl: string
  format: 'jpeg' | 'png' | 'webp'
}

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const PUBLIC_CONVERSATIONS_DIR = path.resolve(workspaceRoot, 'public/content/conversations')

const sanitizeSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown'

const guessFormat = (contentType: string | null, imageUrl: string): 'jpeg' | 'png' | 'webp' => {
  const normalized = (contentType || '').toLowerCase()
  if (normalized.includes('png')) return 'png'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpeg'

  const lowerUrl = imageUrl.toLowerCase()
  if (lowerUrl.includes('.png')) return 'png'
  if (lowerUrl.includes('.webp')) return 'webp'
  return 'jpeg'
}

export const storeConversationImageAsset = async (input: {
  conversationId: string
  imageUrl: string
  requestId?: string
  prefix?: string
}): Promise<StoredConversationImageAsset | null> => {
  const conversationId = sanitizeSegment(input.conversationId)
  const imageUrl = input.imageUrl.trim()
  if (!conversationId || !imageUrl) return null

  try {
    const response = await fetch(imageUrl)
    if (!response.ok) {
      throw new Error(`Image download failed (${response.status})`)
    }
    const format = guessFormat(response.headers.get('content-type'), imageUrl)
    const requestPart = sanitizeSegment(input.requestId || `${Date.now()}`)
    const prefixPart = sanitizeSegment(input.prefix || 'generated')
    const fileName = `${prefixPart}-${requestPart}.${format === 'jpeg' ? 'jpg' : format}`
    const conversationDir = path.resolve(PUBLIC_CONVERSATIONS_DIR, conversationId)
    const localFilePath = path.resolve(conversationDir, fileName)
    await mkdir(conversationDir, { recursive: true })
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(localFilePath, buffer)
    return {
      localUrl: `/content/conversations/${conversationId}/${fileName}`,
      localFilePath,
      originalUrl: imageUrl,
      format,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Conversation image asset storage failed: ${message}`)
    return null
  }
}
