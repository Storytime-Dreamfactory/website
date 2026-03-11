import { readFile } from 'node:fs/promises'
import path from 'node:path'

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export const inferImageMimeType = (filePath: string): string =>
  MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ?? 'image/png'

export const imageBufferToDataUrl = (buffer: Buffer, mimeType: string): string =>
  `data:${mimeType};base64,${buffer.toString('base64')}`

export const readImageAsDataUrl = async (
  filePath: string,
  mimeType = inferImageMimeType(filePath),
): Promise<string> => {
  const buffer = await readFile(filePath)
  return imageBufferToDataUrl(buffer, mimeType)
}
