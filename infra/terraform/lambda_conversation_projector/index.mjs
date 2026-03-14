import crypto from 'node:crypto'
import pg from 'pg'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const { Pool } = pg

const RUNTIME_SECRET_ARN = process.env.RUNTIME_SECRET_ARN || ''
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1'
const secretsManager = new SecretsManagerClient({ region: AWS_REGION })

const SUPPORTED_EVENT_TYPES = new Set([
  'voice.session.requested',
  'voice.user.transcript.received',
  'voice.assistant.transcript.received',
  'voice.session.ended',
  'voice.session.failed',
])

let pool = null
let poolDatabaseUrl = ''
let schemaEnsurePromise = null

const readOptionalString = (value) => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const parseIsoOrNow = (value) => {
  if (typeof value !== 'string' || !value.trim()) return new Date().toISOString()
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

const deriveConversationId = (detail) => {
  const key = readOptionalString(detail.conversationKey)
  if (key) return key
  const correlationId = readOptionalString(detail.correlationId)
  if (correlationId) return correlationId
  return crypto.randomUUID()
}

const getDatabaseUrlFromSecret = async () => {
  if (!RUNTIME_SECRET_ARN) {
    throw new Error('RUNTIME_SECRET_ARN fehlt.')
  }
  const value = await secretsManager.send(
    new GetSecretValueCommand({
      SecretId: RUNTIME_SECRET_ARN,
    }),
  )
  const parsed = value.SecretString ? JSON.parse(value.SecretString) : {}
  const databaseUrl = readOptionalString(parsed.DATABASE_URL)
  if (!databaseUrl) {
    throw new Error('DATABASE_URL fehlt im Runtime-Secret.')
  }
  return databaseUrl
}

const getPool = (databaseUrl) => {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL fehlt.')
  }
  if (pool && poolDatabaseUrl === databaseUrl) return pool
  if (pool) {
    void pool.end().catch(() => undefined)
  }
  poolDatabaseUrl = databaseUrl
  pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 4,
  })
  return pool
}

const ensureProjectionSchema = async (db) => {
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = db.query(`
      CREATE TABLE IF NOT EXISTS conversation_projected_events (
        event_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message_id BIGINT,
        projected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_projected_events_conversation_id
        ON conversation_projected_events (conversation_id);
    `)
  }
  await schemaEnsurePromise
}

const parseRecordEnvelope = (record) => {
  const body = typeof record?.body === 'string' ? record.body : ''
  if (!body) throw new Error('SQS-Nachricht ohne Body.')
  const eventBridgeEvent = JSON.parse(body)
  const detail = eventBridgeEvent?.detail
  if (!detail || typeof detail !== 'object') {
    throw new Error('EventBridge detail fehlt.')
  }

  const eventId = readOptionalString(detail.eventId)
  if (!eventId) throw new Error('eventId fehlt.')

  const eventType = readOptionalString(detail.eventType)
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
    throw new Error(`Nicht unterstuetzter eventType: ${eventType || 'unknown'}`)
  }

  const characterId = readOptionalString(detail.characterId)
  if (!characterId) throw new Error('characterId fehlt.')

  const correlationId = readOptionalString(detail.correlationId)
  if (!correlationId) throw new Error('correlationId fehlt.')

  const occurredAt = parseIsoOrNow(detail.occurredAt)
  const conversationId = deriveConversationId(detail)
  const payload = detail.payload && typeof detail.payload === 'object' ? detail.payload : {}
  const schemaVersion = readOptionalString(detail.schemaVersion) || '1.0'

  const baseMetadata = {
    schemaVersion,
    correlationId,
    conversationKey: readOptionalString(detail.conversationKey) || null,
    payload,
    projectedFrom: eventType,
    projectedAt: new Date().toISOString(),
    source: 'eventbridge.realtime',
  }

  return {
    eventId,
    eventType,
    characterId,
    correlationId,
    conversationId,
    occurredAt,
    payload,
    metadata: baseMetadata,
  }
}

const toMessageInsert = (projection) => {
  if (
    projection.eventType !== 'voice.user.transcript.received' &&
    projection.eventType !== 'voice.assistant.transcript.received'
  ) {
    return null
  }
  const transcript = readOptionalString(projection.payload.transcript)
  if (!transcript) return null
  return {
    role:
      projection.eventType === 'voice.user.transcript.received'
        ? 'user'
        : 'assistant',
    content: transcript,
    eventType: projection.eventType,
    metadata: {
      ...projection.metadata,
      source: 'realtime',
    },
  }
}

const upsertConversationStarted = async (db, projection) => {
  await db.query(
    `
    INSERT INTO conversations (
      conversation_id,
      character_id,
      started_at,
      metadata
    )
    VALUES ($1, $2, $3::timestamptz, $4::jsonb)
    ON CONFLICT (conversation_id)
    DO UPDATE SET
      character_id = EXCLUDED.character_id,
      started_at = LEAST(conversations.started_at, EXCLUDED.started_at),
      metadata = conversations.metadata || EXCLUDED.metadata
    `,
    [
      projection.conversationId,
      projection.characterId,
      projection.occurredAt,
      JSON.stringify({
        ...(projection.metadata ?? {}),
        latestEventType: projection.eventType,
      }),
    ],
  )
}

const mergeConversationEnd = async (db, projection) => {
  await db.query(
    `
    UPDATE conversations
    SET
      ended_at = COALESCE(ended_at, $2::timestamptz),
      metadata = conversations.metadata || $3::jsonb
    WHERE conversation_id = $1
    `,
    [
      projection.conversationId,
      projection.occurredAt,
      JSON.stringify({
        ...projection.metadata,
        latestEventType: projection.eventType,
        endReason:
          readOptionalString(projection.payload.reason) || projection.eventType,
      }),
    ],
  )
}

const insertConversationMessage = async (db, projection, messageInsert) => {
  const result = await db.query(
    `
    INSERT INTO conversation_messages (
      conversation_id,
      role,
      content,
      event_type,
      created_at,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5::timestamptz, $6::jsonb)
    RETURNING message_id
    `,
    [
      projection.conversationId,
      messageInsert.role,
      messageInsert.content,
      messageInsert.eventType,
      projection.occurredAt,
      JSON.stringify(messageInsert.metadata ?? {}),
    ],
  )
  return Number(result.rows[0]?.message_id)
}

const markProjectedEvent = async (db, projection) => {
  const result = await db.query(
    `
    INSERT INTO conversation_projected_events (
      event_id,
      conversation_id,
      event_type
    )
    VALUES ($1, $2, $3)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
    `,
    [projection.eventId, projection.conversationId, projection.eventType],
  )
  return result.rowCount > 0
}

const attachProjectedMessageId = async (db, projection, messageId) => {
  if (!Number.isFinite(messageId)) return
  await db.query(
    `
    UPDATE conversation_projected_events
    SET message_id = $2
    WHERE event_id = $1
    `,
    [projection.eventId, messageId],
  )
}

const sortByCorrelationAndOccurredAt = (items) => {
  const grouped = new Map()
  for (const item of items) {
    const key = item.correlationId
    const list = grouped.get(key) ?? []
    list.push(item)
    grouped.set(key, list)
  }
  const sortedGroups = []
  for (const group of grouped.values()) {
    group.sort((left, right) => {
      const leftTs = Date.parse(left.occurredAt)
      const rightTs = Date.parse(right.occurredAt)
      if (leftTs !== rightTs) return leftTs - rightTs
      return left.eventId.localeCompare(right.eventId)
    })
    sortedGroups.push(...group)
  }
  return sortedGroups
}

const projectSingleEvent = async (db, projection) => {
  await db.query('BEGIN')
  try {
    const isFirstProjection = await markProjectedEvent(db, projection)
    if (!isFirstProjection) {
      await db.query('COMMIT')
      return { projected: false }
    }

    await upsertConversationStarted(db, projection)

    const messageInsert = toMessageInsert(projection)
    if (messageInsert) {
      const messageId = await insertConversationMessage(db, projection, messageInsert)
      await attachProjectedMessageId(db, projection, messageId)
    }

    if (
      projection.eventType === 'voice.session.ended' ||
      projection.eventType === 'voice.session.failed'
    ) {
      await mergeConversationEnd(db, projection)
    }

    await db.query('COMMIT')
    return { projected: true }
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}

export const handler = async (event) => {
  const records = Array.isArray(event?.Records) ? event.Records : []
  if (records.length === 0) {
    return { processed: 0, projected: 0 }
  }
  const databaseUrl = await getDatabaseUrlFromSecret()
  const db = getPool(databaseUrl)
  await ensureProjectionSchema(db)

  const parsed = records.map((record) => parseRecordEnvelope(record))
  const sorted = sortByCorrelationAndOccurredAt(parsed)

  let projectedCount = 0
  for (const projection of sorted) {
    const result = await projectSingleEvent(db, projection)
    if (result.projected) projectedCount += 1
  }
  return { processed: records.length, projected: projectedCount }
}
