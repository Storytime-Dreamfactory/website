import pg from 'pg'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

const { Pool } = pg

const RUNTIME_SECRET_ARN = process.env.RUNTIME_SECRET_ARN || ''
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1'
const secretsManager = new SecretsManagerClient({ region: AWS_REGION })

let pool = null
let poolDatabaseUrl = ''

const EVENT_TO_ACTIVITY_TYPE = {
  'voice.session.requested': 'runtime.voice.session.requested',
  'voice.instructions.updated': 'runtime.voice.instructions.updated',
  'voice.user.transcript.received': 'runtime.voice.user.transcript.received',
  'voice.assistant.transcript.received': 'runtime.voice.assistant.transcript.received',
  'voice.session.ended': 'runtime.voice.session.ended',
  'voice.session.failed': 'runtime.voice.session.failed',
}

const readOptionalString = (value) => {
  if (typeof value !== 'string') return ''
  return value.trim()
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

const parseRecordEnvelope = (record) => {
  const body = typeof record?.body === 'string' ? record.body : ''
  if (!body) throw new Error('SQS-Nachricht ohne Body.')
  const eventBridgeEvent = JSON.parse(body)
  const detail = eventBridgeEvent?.detail
  if (!detail || typeof detail !== 'object') {
    throw new Error('EventBridge detail fehlt.')
  }
  const eventType = typeof detail.eventType === 'string' ? detail.eventType : ''
  const activityType = EVENT_TO_ACTIVITY_TYPE[eventType]
  if (!activityType) {
    throw new Error(`Nicht unterstuetzter eventType: ${eventType || 'unknown'}`)
  }
  const activityId = typeof detail.eventId === 'string' && detail.eventId.trim() ? detail.eventId : null
  if (!activityId) throw new Error('eventId fehlt.')
  const occurredAt =
    typeof detail.occurredAt === 'string' && detail.occurredAt.trim()
      ? detail.occurredAt
      : new Date().toISOString()
  const characterId =
    typeof detail.characterId === 'string' && detail.characterId.trim()
      ? detail.characterId
      : null
  if (!characterId) throw new Error('characterId fehlt.')
  const metadata = {
    schemaVersion: detail.schemaVersion ?? '1.0',
    correlationId: detail.correlationId ?? null,
    conversationKey: detail.conversationKey ?? null,
    payload: detail.payload && typeof detail.payload === 'object' ? detail.payload : {},
    projectedFrom: eventType,
    projectedAt: new Date().toISOString(),
    source: 'eventbridge.realtime',
  }
  return {
    activityId,
    activityType,
    characterId,
    metadata,
    occurredAt,
  }
}

const insertActivityProjection = async (db, projection) => {
  await db.query(
    `
    INSERT INTO character_activities (
      activity_id,
      activity_type,
      is_public,
      character_id,
      metadata,
      subject,
      object,
      occurred_at
    )
    VALUES ($1, $2, false, $3, $4::jsonb, '{}'::jsonb, '{}'::jsonb, $5::timestamptz)
    ON CONFLICT (activity_id) DO NOTHING
    `,
    [
      projection.activityId,
      projection.activityType,
      projection.characterId,
      JSON.stringify(projection.metadata),
      projection.occurredAt,
    ],
  )
}

export const handler = async (event) => {
  const records = Array.isArray(event?.Records) ? event.Records : []
  if (records.length === 0) {
    return { processed: 0 }
  }
  const databaseUrl = await getDatabaseUrlFromSecret()
  const db = getPool(databaseUrl)
  for (const record of records) {
    const projection = parseRecordEnvelope(record)
    await insertActivityProjection(db, projection)
  }
  return { processed: records.length }
}
