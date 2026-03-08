import { Pool } from 'pg'
import { storeConversationImageAsset } from '../src/server/conversationImageAssetStore.ts'

const POSTGRES_DEFAULT_URL = 'postgres://storytime:storytime@localhost:5433/storytime'

type JsonRecord = Record<string, unknown>

type ActivityRow = {
  activity_id: string
  conversation_id: string | null
  metadata: JsonRecord | null
  object: JsonRecord | null
}

const readText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

const readLocalAssetUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().replaceAll('\\', '/')
  if (!normalized) return undefined
  if (normalized.startsWith('/content/')) return normalized
  if (normalized.startsWith('content/')) return `/${normalized}`

  const publicMarker = '/public/'
  const publicMarkerIndex = normalized.lastIndexOf(publicMarker)
  if (publicMarkerIndex !== -1) {
    const relativeToPublic = normalized.slice(publicMarkerIndex + publicMarker.length)
    if (relativeToPublic.startsWith('content/')) return `/${relativeToPublic}`
  }

  const directPublicPrefix = 'public/'
  if (normalized.startsWith(directPublicPrefix)) {
    const relativeToPublic = normalized.slice(directPublicPrefix.length)
    if (relativeToPublic.startsWith('content/')) return `/${relativeToPublic}`
  }

  return undefined
}

const pickRemoteCandidate = (metadata: JsonRecord, objectData: JsonRecord): string | undefined => {
  const values = [
    metadata.originalImageUrl,
    metadata.heroImageUrl,
    metadata.imageUrl,
    metadata.imageLinkUrl,
    objectData.url,
  ]
  for (const value of values) {
    const text = readText(value)
    if (!text) continue
    if (text.startsWith('http://') || text.startsWith('https://')) return text
  }
  return undefined
}

const isObjectEqual = (left: JsonRecord, right: JsonRecord): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const run = async (): Promise<void> => {
  const isDryRun = process.argv.includes('--dry-run')
  const connectionString = process.env.DATABASE_URL?.trim() || POSTGRES_DEFAULT_URL
  const pool = new Pool({ connectionString })

  let scanned = 0
  let updated = 0
  let skipped = 0
  let downloaded = 0
  let failedDownloads = 0

  try {
    const result = await pool.query<ActivityRow>(
      `
      SELECT activity_id, conversation_id, metadata, object
      FROM character_activities
      ORDER BY occurred_at DESC, created_at DESC
      `,
    )

    for (const row of result.rows) {
      scanned += 1
      const metadata: JsonRecord =
        row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
          ? { ...row.metadata }
          : {}
      const objectData: JsonRecord =
        row.object && typeof row.object === 'object' && !Array.isArray(row.object) ? { ...row.object } : {}

      const currentLocalUrl =
        readLocalAssetUrl(metadata.imageAssetPath) ??
        readLocalAssetUrl(metadata.heroImageUrl) ??
        readLocalAssetUrl(metadata.imageUrl) ??
        readLocalAssetUrl(metadata.imageLinkUrl) ??
        readLocalAssetUrl(objectData.url)

      let resolvedLocalUrl = currentLocalUrl
      let resolvedAssetPath = readText(metadata.imageAssetPath)
      const remoteCandidate = pickRemoteCandidate(metadata, objectData)
      const shouldAttemptDownload =
        !resolvedLocalUrl &&
        Boolean(row.conversation_id) &&
        Boolean(remoteCandidate) &&
        (remoteCandidate?.startsWith('http://') || remoteCandidate?.startsWith('https://'))

      if (shouldAttemptDownload) {
        const stored = await storeConversationImageAsset({
          conversationId: row.conversation_id as string,
          imageUrl: remoteCandidate as string,
          requestId: row.activity_id,
          prefix: 'activity-backfill',
        })
        if (stored?.localUrl) {
          resolvedLocalUrl = stored.localUrl
          resolvedAssetPath = stored.localFilePath
          downloaded += 1
        } else {
          failedDownloads += 1
        }
      }

      if (!resolvedLocalUrl) {
        skipped += 1
        continue
      }

      const nextMetadata: JsonRecord = {
        ...metadata,
        heroImageUrl: resolvedLocalUrl,
        imageUrl: resolvedLocalUrl,
        imageLinkUrl: resolvedLocalUrl,
      }
      if (resolvedAssetPath) {
        nextMetadata.imageAssetPath = resolvedAssetPath
      }
      if (remoteCandidate) {
        nextMetadata.originalImageUrl = readText(metadata.originalImageUrl) ?? remoteCandidate
      }

      const nextObject: JsonRecord = {
        ...objectData,
      }
      if (readText(nextObject.type) === 'image' || readText(nextObject.url) || readText(nextMetadata.imageUrl)) {
        nextObject.type = readText(nextObject.type) ?? 'image'
        nextObject.url = resolvedLocalUrl
      }

      if (isObjectEqual(metadata, nextMetadata) && isObjectEqual(objectData, nextObject)) {
        skipped += 1
        continue
      }

      if (!isDryRun) {
        await pool.query(
          `
          UPDATE character_activities
          SET metadata = $2::jsonb, object = $3::jsonb
          WHERE activity_id = $1
          `,
          [row.activity_id, JSON.stringify(nextMetadata), JSON.stringify(nextObject)],
        )
      }
      updated += 1
    }

    console.log(
      JSON.stringify(
        {
          mode: isDryRun ? 'dry-run' : 'apply',
          scanned,
          updated,
          skipped,
          downloaded,
          failedDownloads,
        },
        null,
        2,
      ),
    )
  } finally {
    await pool.end()
  }
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Activity image backfill failed: ${message}`)
  process.exitCode = 1
})
