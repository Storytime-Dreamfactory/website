import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

export type StoredConversationImageAsset = {
  localUrl: string
  localFilePath: string
  thumbnailUrl: string
  thumbnailFilePath: string
  originalUrl: string
  format: 'jpeg' | 'png' | 'webp'
}

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)))
const PUBLIC_CONVERSATIONS_DIR = path.resolve(workspaceRoot, 'public/content/conversations')

const THUMBNAIL_MAX_WIDTH = 512
const THUMBNAIL_JPEG_QUALITY = 60

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

const createThumbnail = async (sourceBuffer: Buffer, targetPath: string): Promise<void> => {
  const thumbnail = await sharp(sourceBuffer)
    .resize({ width: THUMBNAIL_MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: THUMBNAIL_JPEG_QUALITY })
    .toBuffer()
  await writeFile(targetPath, thumbnail)
}

const thumbnailFileName = (originalFileName: string): string => {
  const ext = path.extname(originalFileName)
  const base = path.basename(originalFileName, ext)
  return `${base}.thumb.jpg`
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
    const thumbName = thumbnailFileName(fileName)
    const conversationDir = path.resolve(PUBLIC_CONVERSATIONS_DIR, conversationId)
    const localFilePath = path.resolve(conversationDir, fileName)
    const thumbFilePath = path.resolve(conversationDir, thumbName)
    await mkdir(conversationDir, { recursive: true })
    const buffer = Buffer.from(await response.arrayBuffer())
    await writeFile(localFilePath, buffer)

    try {
      await createThumbnail(buffer, thumbFilePath)
    } catch (thumbError) {
      console.warn(`Thumbnail creation failed: ${thumbError instanceof Error ? thumbError.message : String(thumbError)}`)
    }

    return {
      localUrl: `/content/conversations/${conversationId}/${fileName}`,
      localFilePath,
      thumbnailUrl: `/content/conversations/${conversationId}/${thumbName}`,
      thumbnailFilePath: thumbFilePath,
      originalUrl: imageUrl,
      format,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`Conversation image asset storage failed: ${message}`)
    return null
  }
}

export const readThumbnailAsBase64 = async (
  imageLocalUrl: string,
): Promise<{ base64: string; mimeType: string } | null> => {
  if (!imageLocalUrl) return null

  const thumbName = thumbnailFileName(path.basename(imageLocalUrl))
  const thumbPath = path.resolve(
    workspaceRoot,
    'public',
    path.dirname(imageLocalUrl).replace(/^\/+/, ''),
    thumbName,
  )

  try {
    const buffer = await readFile(thumbPath)
    return { base64: buffer.toString('base64'), mimeType: 'image/jpeg' }
  } catch {
    // Thumbnail doesn't exist yet (older images) — fall back to full image
  }

  const fullPath = path.resolve(
    workspaceRoot,
    'public',
    imageLocalUrl.replace(/^\/+/, ''),
  )
  try {
    const buffer = await readFile(fullPath)
    const thumbnail = await sharp(buffer)
      .resize({ width: THUMBNAIL_MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: THUMBNAIL_JPEG_QUALITY })
      .toBuffer()
    return { base64: thumbnail.toString('base64'), mimeType: 'image/jpeg' }
  } catch {
    return null
  }
}
