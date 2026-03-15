import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs'
import crypto from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import pg from 'pg'

const { Pool } = pg
const s3 = new S3Client({})
const secretsManager = new SecretsManagerClient({})

const CONTENT_BUCKET = process.env.CONTENT_BUCKET || ''
const RUNTIME_SECRET_ARN = process.env.RUNTIME_SECRET_ARN || ''
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1'
const CHARACTER_CREATION_QUEUE_URL = process.env.CHARACTER_CREATION_QUEUE_URL || ''

const REALTIME_EVENT_SCHEMA_VERSION = '1.0'
const REALTIME_EVENT_TYPES = new Set([
  'voice.session.requested',
  'voice.instructions.updated',
  'voice.user.transcript.received',
  'voice.assistant.transcript.received',
  'voice.session.ended',
  'voice.session.failed',
])

let cachedObjects = null
let cachedAt = 0
const CACHE_TTL_MS = 30_000
let pool = null
let eventBridgeClient = null
let sqsClient = null
let runtimeConfigPromise = null
let runtimeConfigCachedAt = 0
const RUNTIME_CONFIG_CACHE_TTL_MS = 60_000
let cachedDatabaseUrl = process.env.DATABASE_URL || ''
let characterCreationSchemaEnsured = false

const json = (statusCode, data) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(
    data &&
      typeof data === 'object' &&
      typeof data.error === 'string' &&
      typeof data.message !== 'string'
      ? { ...data, message: data.error }
      : data,
  ),
})

const readBody = async (stream) => {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const readJsonBodyFromEvent = (event) => {
  if (!event?.body) return {}
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
  return raw ? JSON.parse(raw) : {}
}

const readOptionalString = (value) => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

const parseBoolean = (value) => {
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

const isRealtimeEventType = (value) => typeof value === 'string' && REALTIME_EVENT_TYPES.has(value)

const getRuntimeConfig = async () => {
  const now = Date.now()
  if (runtimeConfigPromise && now - runtimeConfigCachedAt < RUNTIME_CONFIG_CACHE_TTL_MS) {
    return runtimeConfigPromise
  }
  runtimeConfigPromise = (async () => {
    if (!RUNTIME_SECRET_ARN) {
      return {
        openAiApiKey: process.env.OPENAI_API_KEY || '',
        realtimeEventBridgeEnabled: parseBoolean(process.env.REALTIME_EVENTBRIDGE_ENABLED || 'true'),
        realtimeEventBridgeStrict: parseBoolean(process.env.REALTIME_EVENTBRIDGE_STRICT || 'false'),
        realtimeEventBridgeBusName:
          process.env.REALTIME_EVENTBRIDGE_BUS_NAME || process.env.ACTIVITY_EVENTBRIDGE_BUS_NAME || '',
        realtimeEventBridgeSource: process.env.REALTIME_EVENTBRIDGE_SOURCE || 'storytime.realtime',
        realtimeEventBridgeDetailTypePrefix:
          process.env.REALTIME_EVENTBRIDGE_DETAIL_TYPE_PREFIX || 'storytime.voice',
        databaseUrl: process.env.DATABASE_URL || '',
      }
    }
    const secretValue = await secretsManager.send(
      new GetSecretValueCommand({
        SecretId: RUNTIME_SECRET_ARN,
      }),
    )
    const parsed = secretValue.SecretString ? JSON.parse(secretValue.SecretString) : {}
    return {
      openAiApiKey: readOptionalString(parsed.OPENAI_API_KEY) || process.env.OPENAI_API_KEY || '',
      realtimeEventBridgeEnabled: parseBoolean(
        readOptionalString(parsed.REALTIME_EVENTBRIDGE_ENABLED) ||
          process.env.REALTIME_EVENTBRIDGE_ENABLED ||
          'true',
      ),
      realtimeEventBridgeStrict: parseBoolean(
        readOptionalString(parsed.REALTIME_EVENTBRIDGE_STRICT) ||
          process.env.REALTIME_EVENTBRIDGE_STRICT ||
          'false',
      ),
      realtimeEventBridgeBusName:
        readOptionalString(parsed.REALTIME_EVENTBRIDGE_BUS_NAME) ||
        process.env.REALTIME_EVENTBRIDGE_BUS_NAME ||
        readOptionalString(parsed.ACTIVITY_EVENTBRIDGE_BUS_NAME) ||
        process.env.ACTIVITY_EVENTBRIDGE_BUS_NAME ||
        '',
      realtimeEventBridgeSource:
        readOptionalString(parsed.REALTIME_EVENTBRIDGE_SOURCE) ||
        process.env.REALTIME_EVENTBRIDGE_SOURCE ||
        'storytime.realtime',
      realtimeEventBridgeDetailTypePrefix:
        readOptionalString(parsed.REALTIME_EVENTBRIDGE_DETAIL_TYPE_PREFIX) ||
        process.env.REALTIME_EVENTBRIDGE_DETAIL_TYPE_PREFIX ||
        'storytime.voice',
      databaseUrl: readOptionalString(parsed.DATABASE_URL) || process.env.DATABASE_URL || '',
    }
  })()
  const resolved = await runtimeConfigPromise
  runtimeConfigCachedAt = Date.now()
  cachedDatabaseUrl = resolved.databaseUrl || ''
  if (!cachedDatabaseUrl && pool) {
    void pool.end().catch(() => undefined)
    pool = null
  }
  if (!resolved.openAiApiKey) {
    // Bei fehlendem Key nicht hart cachen, damit frisch gesetzte Secrets schnell wirksam werden.
    runtimeConfigPromise = null
    runtimeConfigCachedAt = 0
  }
  return resolved
}

const getEventBridgeClient = () => {
  if (eventBridgeClient) return eventBridgeClient
  eventBridgeClient = new EventBridgeClient({ region: AWS_REGION })
  return eventBridgeClient
}

const buildRealtimeEventEnvelope = (input) => {
  if (!input.eventId) throw new Error('eventId ist erforderlich.')
  if (!input.correlationId) throw new Error('correlationId ist erforderlich.')
  if (!input.characterId) throw new Error('characterId ist erforderlich.')
  if (!isRealtimeEventType(input.eventType)) throw new Error('eventType ist ungueltig.')
  return {
    eventId: input.eventId,
    correlationId: input.correlationId,
    conversationKey: input.conversationKey || undefined,
    characterId: input.characterId,
    eventType: input.eventType,
    occurredAt: input.occurredAt || new Date().toISOString(),
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    schemaVersion: REALTIME_EVENT_SCHEMA_VERSION,
  }
}

const publishRealtimeEvent = async (envelope) => {
  const config = await getRuntimeConfig()
  if (!config.realtimeEventBridgeEnabled) return

  if (!config.realtimeEventBridgeBusName) {
    if (config.realtimeEventBridgeStrict) {
      throw new Error('REALTIME_EVENTBRIDGE_BUS_NAME fehlt.')
    }
    console.warn('[realtime-eventbridge] Bus-Name fehlt, Event wird uebersprungen.')
    return
  }

  const client = getEventBridgeClient()
  const command = new PutEventsCommand({
    Entries: [
      {
        EventBusName: config.realtimeEventBridgeBusName,
        Source: config.realtimeEventBridgeSource,
        DetailType: `${config.realtimeEventBridgeDetailTypePrefix}.${envelope.eventType}`,
        Time: new Date(envelope.occurredAt),
        Detail: JSON.stringify(envelope),
      },
    ],
  })
  const result = await client.send(command)
  if (Number(result.FailedEntryCount || 0) > 0) {
    const reason = result.Entries?.[0]?.ErrorMessage || 'PutEvents fehlgeschlagen'
    throw new Error(reason)
  }
}

const buildBasicVoiceInstructions = (characterObject) => {
  const name = typeof characterObject?.name === 'string' ? characterObject.name : 'dein Charakter'
  const shortDescription =
    typeof characterObject?.shortDescription === 'string' ? characterObject.shortDescription.trim() : ''
  const parts = [
    `Du bist ${name} und sprichst kindgerecht, freundlich und auf Deutsch.`,
    'Halte Antworten kurz und lebendig.',
    'Stelle am Ende jeder Antwort genau eine kurze Anschlussfrage.',
  ]
  if (shortDescription) {
    parts.push(`Charakter-Kontext: ${shortDescription}`)
  }
  return parts.join('\n')
}

const resolveVoiceName = (characterObject) => {
  if (typeof characterObject?.voice === 'string' && characterObject.voice.trim()) {
    return characterObject.voice.trim()
  }
  return 'alloy'
}

const createRealtimeSessionToken = async ({ openAiApiKey, instructions, voice }) => {
  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-realtime',
      voice,
      instructions,
      input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
      turn_detection: {
        type: 'server_vad',
        create_response: true,
        interrupt_response: false,
        silence_duration_ms: 900,
      },
    }),
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI session creation failed (${response.status}): ${body}`)
  }
  const data = await response.json()
  return {
    token: data?.client_secret?.value,
    expiresAt: data?.client_secret?.expires_at,
  }
}

const getPool = () => {
  if (!cachedDatabaseUrl) return null
  if (pool) return pool
  pool = new Pool({
    connectionString: cachedDatabaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 4,
  })
  return pool
}

const getSqsClient = () => {
  if (sqsClient) return sqsClient
  sqsClient = new SQSClient({ region: AWS_REGION })
  return sqsClient
}

const readHeader = (event, name) => {
  const headers = event?.headers
  if (!headers || typeof headers !== 'object') return ''
  const normalized = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalized) continue
    return typeof value === 'string' ? value.trim() : ''
  }
  return ''
}

const pickCharacterCreationPhase = (status) => {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'running') return 'generating'
  return 'draft'
}

const hashPayload = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')

const deriveCharacterCreationIdempotencyKey = (event, body) => {
  const explicit =
    readOptionalString(body.idempotencyKey) ||
    readOptionalString(readHeader(event, 'x-idempotency-key'))
  if (explicit) return explicit
  const prompt = readOptionalString(body.prompt) || ''
  const yamlText = readOptionalString(body.yamlText) || ''
  const fillMissingFieldsCreatively = Boolean(body.fillMissingFieldsCreatively)
  const referenceImageIds = Array.isArray(body.referenceImageIds)
    ? body.referenceImageIds.filter((entry) => typeof entry === 'string').sort()
    : []
  return hashPayload({
    prompt,
    yamlText,
    fillMissingFieldsCreatively,
    referenceImageIds,
  })
}

const ensureCharacterCreationSchema = async (db) => {
  if (characterCreationSchemaEnsured) return
  await db.query(`
    CREATE TABLE IF NOT EXISTS character_creation_jobs (
      job_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('accepted', 'queued', 'running', 'completed', 'failed')),
      phase TEXT NOT NULL DEFAULT 'draft',
      message TEXT NOT NULL,
      prompt TEXT,
      yaml_text TEXT,
      character_id TEXT,
      content_path TEXT,
      manifest_path TEXT,
      error TEXT,
      fill_missing_fields_creatively BOOLEAN NOT NULL DEFAULT FALSE,
      reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,
      assets JSONB NOT NULL DEFAULT '[]'::jsonb,
      request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      current_step TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      queued_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_character_creation_jobs_status
      ON character_creation_jobs (status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS character_creation_steps (
      job_id TEXT NOT NULL REFERENCES character_creation_jobs(job_id) ON DELETE CASCADE,
      step_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (job_id, step_name, created_at)
    );

    CREATE TABLE IF NOT EXISTS character_creation_reference_images (
      reference_image_id TEXT PRIMARY KEY,
      storage_bucket TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS event_outbox (
      outbox_id BIGSERIAL PRIMARY KEY,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_key TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ux_event_outbox_event_key
      ON event_outbox (event_key)
      WHERE event_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
      ON event_outbox (status, next_attempt_at, created_at);
  `)
  characterCreationSchemaEnsured = true
}

const mapCharacterCreationJobRow = (row) => ({
  id: row.job_id,
  updatedAt: row.updated_at,
  phase: pickCharacterCreationPhase(row.status),
  message: row.message || 'Job angelegt.',
  characterId: row.character_id || undefined,
  error: row.error || undefined,
  assets: Array.isArray(row.assets) ? row.assets : [],
  status: row.status,
})

const safeFileName = (value) => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  const fallback = trimmed || 'reference-image.png'
  return fallback.replace(/[^a-zA-Z0-9._-]+/g, '-')
}

const extensionForMimeType = (mimeType) => {
  if (mimeType === 'image/jpeg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  return '.png'
}

const parseImageDataUrl = (dataUrl) => {
  const match = typeof dataUrl === 'string' ? dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/) : null
  if (!match) {
    throw new Error('Ungueltiges Bildformat. Bitte lade eine PNG-, JPG-, WEBP- oder GIF-Datei hoch.')
  }
  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], 'base64'),
  }
}

const buildFallbackChatReply = (messages) => {
  const userMessages = messages
    .filter((message) => message.role === 'user')
    .map((message) => (typeof message.content === 'string' ? message.content.trim() : ''))
    .filter((value) => value.length > 0)
  const compiledPrompt = userMessages.join('\n')
  const isReady = compiledPrompt.length >= 80
  return {
    reply: isReady
      ? 'Wunderbar, ich habe schon genug fuer deinen Character. Du kannst jetzt auf Erstellen klicken.'
      : 'Ich bin Merlin. Erzaehl mir noch etwas mehr ueber deinen Character. Zum Beispiel: Name, Aussehen oder was ihn besonders macht.',
    isReady,
    compiledPrompt,
  }
}

const normalizePathToKey = (pathValue) => pathValue.replace(/^\//, '')

const deriveSlugFromPath = (filePath) => {
  const segments = filePath.split('/')
  const fileName = segments[segments.length - 1] || ''
  if (/^character\.ya?ml$/i.test(fileName)) {
    return segments[segments.length - 2] || 'unknown'
  }
  return fileName.replace(/\.ya?ml$/i, '') || 'unknown'
}

const classifyTypeFromPath = (filePath) => {
  if (filePath.includes('/characters/')) return 'character'
  if (filePath.includes('/places/')) return 'place'
  if (filePath.includes('/learning-goals/')) return 'learning-goals'
  if (filePath.includes('/artifacts/')) return 'artifact'
  return 'character'
}

const fetchS3Text = async (key) => {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: CONTENT_BUCKET,
      Key: key,
    }),
  )
  return readBody(result.Body)
}

const readManifest = async () => {
  const manifestRaw = await fetchS3Text('content-manifest.json')
  return JSON.parse(manifestRaw)
}

const loadGameObjects = async () => {
  if (!CONTENT_BUCKET) {
    throw new Error('CONTENT_BUCKET not configured.')
  }
  const now = Date.now()
  if (cachedObjects && now - cachedAt < CACHE_TTL_MS) {
    return cachedObjects
  }

  const manifest = await readManifest()
  const allPaths = [
    ...(Array.isArray(manifest.characters) ? manifest.characters : []),
    ...(Array.isArray(manifest.places) ? manifest.places : []),
    ...(Array.isArray(manifest.learningGoals) ? manifest.learningGoals : []),
    ...(Array.isArray(manifest.artifacts) ? manifest.artifacts : []),
  ]

  const objects = []
  for (const pathValue of allPaths) {
    const key = normalizePathToKey(pathValue)
    const rawYaml = await fetchS3Text(key)
    const parsed = parseYaml(rawYaml)
    if (!parsed || typeof parsed !== 'object') continue
    const gameObject = parsed
    if (typeof gameObject.id !== 'string') continue
    gameObject.type = classifyTypeFromPath(pathValue)
    gameObject.slug = deriveSlugFromPath(pathValue)
    objects.push(gameObject)
  }

  const byId = new Map(objects.map((obj) => [obj.id, obj]))
  const byTypeAndSlug = new Map(objects.map((obj) => [`${obj.type}:${obj.slug}`, obj]))
  cachedObjects = { objects, byId, byTypeAndSlug }
  cachedAt = now
  return cachedObjects
}

const getObjectByIdOrSlug = async (idOrSlug) => {
  const store = await loadGameObjects()
  const direct = store.byId.get(idOrSlug)
  if (direct) return direct
  for (const type of ['character', 'place', 'learning-goals', 'artifact']) {
    const bySlug = store.byTypeAndSlug.get(`${type}:${idOrSlug}`)
    if (bySlug) return bySlug
  }
  return null
}

const toImageList = (gameObject) => {
  if (!gameObject || gameObject.type !== 'character') return []
  const images = []
  const add = (slot, image, type) => {
    const url = typeof image?.file === 'string' ? image.file.trim() : ''
    if (!url) return
    images.push({
      slot,
      url,
      description: typeof image?.description === 'string' ? image.description.trim() : undefined,
      type,
    })
  }
  add('standardFigure', gameObject.images?.standardFigure)
  add('heroImage', gameObject.images?.heroImage)
  add('portrait', gameObject.images?.portrait)
  add('profileImage', gameObject.images?.profileImage)
  for (const image of Array.isArray(gameObject.images?.additionalImages) ? gameObject.images.additionalImages : []) {
    add('additional', image, image?.type)
  }
  return images
}

const listRelationshipsForObject = async (objectId) => {
  const db = getPool()
  if (!db) return []
  const result = await db.query(
    `
    SELECT
      relationship_id,
      source_character_id,
      target_character_id,
      relationship_type,
      relationship_type_readable,
      relationship,
      description,
      metadata,
      other_related_objects,
      created_at::text,
      updated_at::text
    FROM character_relationships
    WHERE source_character_id = $1 OR target_character_id = $1
    ORDER BY updated_at DESC
    `,
    [objectId],
  )
  const store = await loadGameObjects()
  const toCtx = (id) => {
    const obj = store.byId.get(id)
    return obj
      ? { id: obj.id, name: obj.name || obj.id, type: obj.type, slug: obj.slug || obj.id }
      : { id, name: id, type: 'character', slug: id }
  }
  return result.rows.map((row) => ({
    relationshipId: row.relationship_id,
    source: toCtx(row.source_character_id),
    target: toCtx(row.target_character_id),
    relationshipType: row.relationship_type,
    relationshipTypeReadable: row.relationship_type_readable || row.relationship_type,
    relationship: row.relationship,
    description: row.description || undefined,
    otherRelatedObjects: Array.isArray(row.other_related_objects) ? row.other_related_objects : [],
    direction: row.source_character_id === objectId ? 'outgoing' : 'incoming',
  }))
}

const listRelationships = async (query) => {
  const db = getPool()
  if (!db) return { relationships: [] }
  if (query.path === '/all') {
    const result = await db.query('SELECT * FROM character_relationships ORDER BY updated_at DESC')
    return {
      relationships: result.rows.map((row) => ({
        relationshipId: row.relationship_id,
        sourceCharacterId: row.source_character_id,
        targetCharacterId: row.target_character_id,
        relationshipType: row.relationship_type,
        relationshipTypeReadable: row.relationship_type_readable || row.relationship_type,
        relationship: row.relationship,
        description: row.description || undefined,
        metadata: row.metadata || {},
        otherRelatedObjects: Array.isArray(row.other_related_objects) ? row.other_related_objects : [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    }
  }
  if (query.path === '/by-object') {
    const type = query.searchParams.get('type')?.trim() || ''
    const id = query.searchParams.get('id')?.trim() || ''
    if (!type || !id) return { error: 'type und id sind erforderlich.' }
    const result = await db.query(
      `SELECT * FROM character_relationships WHERE other_related_objects @> $1::jsonb ORDER BY updated_at DESC`,
      [JSON.stringify([{ type, id }])],
    )
    return { type, id, matches: result.rows }
  }
  const characterId = query.searchParams.get('characterId')?.trim() || ''
  if (!characterId) return { error: 'characterId ist erforderlich.' }
  const result = await db.query(
    `
    SELECT *, 'outgoing'::text AS direction FROM character_relationships WHERE source_character_id = $1
    UNION ALL
    SELECT *, 'incoming'::text AS direction FROM character_relationships WHERE target_character_id = $1
    ORDER BY updated_at DESC
    `,
    [characterId],
  )
  return {
    relationships: result.rows.map((row) => ({
      relationshipId: row.relationship_id,
      sourceCharacterId: row.source_character_id,
      targetCharacterId: row.target_character_id,
      relationshipType: row.relationship_type,
      relationshipTypeReadable: row.relationship_type_readable || row.relationship_type,
      relationship: row.relationship,
      description: row.description || undefined,
      metadata: row.metadata || {},
      otherRelatedObjects: Array.isArray(row.other_related_objects) ? row.other_related_objects : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      direction: row.direction,
    })),
  }
}

const upsertRelationship = async (body) => {
  const db = getPool()
  if (!db) return { error: 'DATABASE_URL fehlt.' }
  const sourceCharacterId = typeof body.sourceCharacterId === 'string' ? body.sourceCharacterId.trim() : ''
  const targetCharacterId = typeof body.targetCharacterId === 'string' ? body.targetCharacterId.trim() : ''
  const relationshipType = typeof body.relationshipType === 'string' ? body.relationshipType.trim() : ''
  const relationship = typeof body.relationship === 'string' ? body.relationship.trim() : ''
  if (!sourceCharacterId || !targetCharacterId || !relationshipType || !relationship) {
    return { error: 'sourceCharacterId, targetCharacterId, relationshipType und relationship sind erforderlich.' }
  }
  const relationshipId = `${sourceCharacterId}#${targetCharacterId}#${relationshipType}`.toLowerCase()
  const result = await db.query(
    `
    INSERT INTO character_relationships (
      relationship_id, source_character_id, target_character_id, relationship_type,
      relationship_type_readable, relationship, description, metadata, other_related_objects
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
    ON CONFLICT (relationship_id)
    DO UPDATE SET
      relationship_type_readable = EXCLUDED.relationship_type_readable,
      relationship = EXCLUDED.relationship,
      description = EXCLUDED.description,
      metadata = EXCLUDED.metadata,
      other_related_objects = EXCLUDED.other_related_objects,
      updated_at = NOW()
    RETURNING *
    `,
    [
      relationshipId,
      sourceCharacterId,
      targetCharacterId,
      relationshipType,
      typeof body.relationshipTypeReadable === 'string' ? body.relationshipTypeReadable : relationshipType,
      relationship,
      typeof body.description === 'string' ? body.description : null,
      JSON.stringify(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
      JSON.stringify(Array.isArray(body.otherRelatedObjects) ? body.otherRelatedObjects : []),
    ],
  )
  return { relationship: result.rows[0] }
}

const listActivities = async (requestUrl) => {
  const db = getPool()
  if (!db) return { activities: [] }
  const includeNonPublic = ['1', 'true'].includes(
    (requestUrl.searchParams.get('includeNonPublic') || '').toLowerCase(),
  )
  const conditions = []
  const values = []
  if (!includeNonPublic) {
    values.push(true)
    conditions.push(`is_public = $${values.length}`)
  }
  const addEq = (field, key) => {
    const value = requestUrl.searchParams.get(key)?.trim()
    if (!value) return
    values.push(value)
    conditions.push(`${field} = $${values.length}`)
  }
  addEq('character_id', 'characterId')
  addEq('place_id', 'placeId')
  addEq('conversation_id', 'conversationId')
  addEq('activity_type', 'activityType')
  const learningGoalId =
    requestUrl.searchParams.get('learningGoalId') ||
    requestUrl.searchParams.get('learning_goal_id') ||
    requestUrl.searchParams.get('skillId')
  if (learningGoalId?.trim()) {
    values.push(learningGoalId.trim())
    conditions.push(`$${values.length} = ANY(learning_goal_ids)`)
  }
  const limit = Math.max(1, Math.min(500, Number.parseInt(requestUrl.searchParams.get('limit') || '100', 10) || 100))
  const offset = Math.max(0, Number.parseInt(requestUrl.searchParams.get('offset') || '0', 10) || 0)
  values.push(limit)
  const limitParam = `$${values.length}`
  values.push(offset)
  const offsetParam = `$${values.length}`
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const result = await db.query(
    `
    SELECT
      activity_id, activity_type, is_public, character_id, place_id, learning_goal_ids, skill_ids,
      conversation_id, subject, object, metadata, story_summary, occurred_at::text, created_at::text
    FROM character_activities
    ${whereClause}
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT ${limitParam}
    OFFSET ${offsetParam}
    `,
    values,
  )
  return {
    activities: result.rows.map((row) => ({
      activityId: row.activity_id,
      activityType: row.activity_type,
      isPublic: row.is_public,
      characterId: row.character_id || undefined,
      placeId: row.place_id || undefined,
      learningGoalIds: Array.isArray(row.learning_goal_ids) ? row.learning_goal_ids : [],
      conversationId: row.conversation_id || undefined,
      subject: row.subject || {},
      object: row.object || {},
      metadata: row.metadata || {},
      storySummary: row.story_summary || undefined,
      occurredAt: row.occurred_at,
      createdAt: row.created_at,
    })),
  }
}

const toConversationRecord = (row) => ({
  conversationId: row.conversation_id,
  userId: row.user_id || undefined,
  characterId: row.character_id,
  startedAt: new Date(row.started_at).toISOString(),
  endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : undefined,
  metadata: row.metadata || {},
})

const toConversationMessageRecord = (row) => ({
  messageId: Number(row.message_id),
  conversationId: row.conversation_id,
  role: row.role,
  content: row.content,
  eventType: row.event_type || undefined,
  createdAt: new Date(row.created_at).toISOString(),
  metadata: row.metadata || {},
})

const getConversationDetails = async (conversationId) => {
  const db = getPool()
  if (!db) throw new Error('DATABASE_URL fehlt.')

  const normalizedConversationId = readOptionalString(conversationId)
  if (!normalizedConversationId) {
    throw new Error('conversationId ist erforderlich.')
  }

  const conversationResult = await db.query(
    `
    SELECT
      conversation_id,
      user_id,
      character_id,
      started_at::text,
      ended_at::text,
      metadata
    FROM conversations
    WHERE conversation_id = $1
    LIMIT 1
    `,
    [normalizedConversationId],
  )
  if (conversationResult.rowCount === 0) return null

  const messageResult = await db.query(
    `
    SELECT
      message_id,
      conversation_id,
      role,
      content,
      event_type,
      created_at::text,
      metadata
    FROM conversation_messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC, message_id ASC
    `,
    [normalizedConversationId],
  )

  return {
    conversation: toConversationRecord(conversationResult.rows[0]),
    messages: messageResult.rows.map((row) => toConversationMessageRecord(row)),
  }
}

const getLatestConversationForCharacter = async (characterId) => {
  const db = getPool()
  if (!db) throw new Error('DATABASE_URL fehlt.')

  const normalizedCharacterId = readOptionalString(characterId)
  if (!normalizedCharacterId) {
    throw new Error('characterId ist erforderlich.')
  }

  const conversationResult = await db.query(
    `
    SELECT
      conversation_id,
      user_id,
      character_id,
      started_at::text,
      ended_at::text,
      metadata
    FROM conversations
    WHERE character_id = $1
    ORDER BY started_at DESC
    LIMIT 1
    `,
    [normalizedCharacterId],
  )
  if (conversationResult.rowCount === 0) return null

  const details = await getConversationDetails(conversationResult.rows[0].conversation_id)
  return details
}

const getCharacterIdsWithConversations = async () => {
  const db = getPool()
  if (!db) return []
  const result = await db.query(
    `
    SELECT DISTINCT c.character_id
    FROM conversations c
    INNER JOIN conversation_messages m ON m.conversation_id = c.conversation_id
    WHERE m.role IN ('user', 'assistant')
    ORDER BY c.character_id ASC
    `,
  )
  return result.rows
    .map((row) => readOptionalString(row.character_id))
    .filter((value) => Boolean(value))
}

export const handler = async (event) => {
  const routeKey = event?.routeKey || 'UNKNOWN'
  const path = event?.rawPath || ''
  const requestUrl = new URL(event?.rawPath + (event?.rawQueryString ? `?${event.rawQueryString}` : ''), 'https://api')

  try {
    await getRuntimeConfig()
    if (routeKey === 'GET /health' || path === '/health') {
      return json(200, { status: 'ok', service: 'storytime-api' })
    }
    if (routeKey === 'GET /ready' || path === '/ready') {
      return json(200, { status: 'ready', mode: 'content-first' })
    }

    // Game Objects
    if (routeKey === 'GET /api/game-objects' || routeKey === 'GET /api/gameobjects') {
      const requestedType = requestUrl.searchParams.get('type')?.trim() || ''
      const slug = requestUrl.searchParams.get('slug')?.trim() || ''
      const id = requestUrl.searchParams.get('id')?.trim() || ''
      if (id || slug) {
        const gameObject = await getObjectByIdOrSlug(id || slug)
        if (!gameObject) return json(404, { error: 'GameObject nicht gefunden.' })
        return json(200, { gameObject })
      }
      const store = await loadGameObjects()
      const gameObjects = requestedType
        ? store.objects.filter((obj) => obj.type === requestedType)
        : store.objects
      return json(200, { gameObjects })
    }

    if (
      routeKey === 'GET /api/game-objects/{id}' ||
      routeKey === 'GET /api/gameobjects/{id}'
    ) {
      const id = event?.pathParameters?.id || ''
      const gameObject = await getObjectByIdOrSlug(id)
      if (!gameObject) return json(404, { error: 'GameObject nicht gefunden.' })
      return json(200, { gameObject })
    }

    if (
      routeKey === 'GET /api/game-objects/{id}/images' ||
      routeKey === 'GET /api/gameobjects/{id}/images'
    ) {
      const id = event?.pathParameters?.id || ''
      const gameObject = await getObjectByIdOrSlug(id)
      if (!gameObject) return json(404, { error: 'GameObject nicht gefunden.' })
      return json(200, {
        gameObject: {
          id: gameObject.id,
          slug: gameObject.slug,
          type: gameObject.type,
          name: gameObject.name,
        },
        images: toImageList(gameObject),
      })
    }

    if (
      routeKey === 'GET /api/game-objects/{id}/relationships' ||
      routeKey === 'GET /api/gameobjects/{id}/relationships'
    ) {
      const id = event?.pathParameters?.id || ''
      const gameObject = await getObjectByIdOrSlug(id)
      if (!gameObject) return json(404, { error: 'GameObject nicht gefunden.' })
      const relationships = await listRelationshipsForObject(gameObject.id)
      return json(200, { gameObject, relationships })
    }

    // Relationships
    if (routeKey === 'GET /api/relationships') {
      const payload = await listRelationships({
        path: '/',
        searchParams: requestUrl.searchParams,
      })
      if (payload.error) return json(400, { error: payload.error })
      return json(200, payload)
    }
    if (routeKey === 'GET /api/relationships/all') {
      const payload = await listRelationships({
        path: '/all',
        searchParams: requestUrl.searchParams,
      })
      return json(200, payload)
    }
    if (routeKey === 'GET /api/relationships/by-object') {
      const payload = await listRelationships({
        path: '/by-object',
        searchParams: requestUrl.searchParams,
      })
      if (payload.error) return json(400, { error: payload.error })
      return json(200, payload)
    }
    if (routeKey === 'GET /api/relationships/knowledge') {
      const characterId = requestUrl.searchParams.get('characterId')?.trim() || ''
      if (!characterId) return json(400, { error: 'characterId ist erforderlich.' })
      const rel = await listRelationships({ path: '/', searchParams: requestUrl.searchParams })
      if (rel.error) return json(400, { error: rel.error })
      const store = await loadGameObjects()
      const relatedObjects = []
      for (const relationship of rel.relationships || []) {
        const relatedCharacterId =
          relationship.direction === 'outgoing'
            ? relationship.targetCharacterId
            : relationship.sourceCharacterId
        const obj = store.byId.get(relatedCharacterId)
        if (!obj || obj.type !== 'character') continue
        relatedObjects.push({
          type: 'character',
          characterId: obj.id,
          name: obj.name,
          species: obj.basis?.species || undefined,
          shortDescription: obj.shortDescription || undefined,
          coreTraits: Array.isArray(obj.personality?.coreTraits) ? obj.personality.coreTraits : [],
        })
      }
      return json(200, { characterId, relationships: rel.relationships || [], relatedObjects })
    }
    if (routeKey === 'POST /api/relationships') {
      const body = event?.body ? JSON.parse(event.body) : {}
      const payload = await upsertRelationship(body)
      if (payload.error) return json(400, { error: payload.error })
      return json(201, payload)
    }

    // Activities read-first
    if (routeKey === 'GET /api/conversations') {
      const conversationId = requestUrl.searchParams.get('conversationId') || ''
      if (!conversationId.trim()) return json(400, { error: 'conversationId ist erforderlich.' })
      const details = await getConversationDetails(conversationId)
      if (!details) return json(404, { error: 'Conversation nicht gefunden.' })
      return json(200, details)
    }

    if (routeKey === 'GET /api/conversations/latest') {
      const characterId = requestUrl.searchParams.get('characterId') || ''
      if (!characterId.trim()) return json(400, { error: 'characterId ist erforderlich.' })
      const details = await getLatestConversationForCharacter(characterId)
      if (!details) {
        return json(404, { error: 'Keine Conversation fuer diesen Character gefunden.' })
      }
      return json(200, details)
    }

    if (routeKey === 'GET /api/conversations/characters-with-conversations') {
      const characterIds = await getCharacterIdsWithConversations()
      return json(200, { characterIds })
    }

    if (routeKey === 'GET /api/activities') {
      const payload = await listActivities(requestUrl)
      return json(200, payload)
    }
    if (routeKey === 'GET /api/activities/stream') {
      const summaryOnly = ['1', 'true'].includes(
        (requestUrl.searchParams.get('summaryOnly') || '').toLowerCase(),
      )
      const streamUrl = new URL(requestUrl.toString())
      if (!streamUrl.searchParams.get('limit')) {
        streamUrl.searchParams.set('limit', '30')
      }
      const payload = await listActivities(streamUrl)
      const activities = (payload.activities || []).filter((activity) =>
        summaryOnly ? Boolean(activity.storySummary && activity.storySummary.trim()) : true,
      )

      const chunks = ['retry: 3000', 'event: ready', 'data: {"status":"connected"}', '']
      for (const activity of activities) {
        chunks.push(`id: ${activity.activityId}`)
        chunks.push('event: activity.created')
        chunks.push(`data: ${JSON.stringify(activity)}`)
        chunks.push('')
      }

      return {
        statusCode: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
        },
        body: chunks.join('\n'),
      }
    }

    // Character Creator (Hybrid foundation: Postgres state + SQS delivery)
    if (routeKey === 'GET /api/character-creator/jobs/{id}') {
      const jobId = readOptionalString(event?.pathParameters?.id)
      if (!jobId) return json(400, { error: 'jobId ist erforderlich.' })
      const db = getPool()
      if (!db) return json(503, { error: 'DATABASE_URL fehlt.' })
      await ensureCharacterCreationSchema(db)
      const result = await db.query(
        `
        SELECT
          job_id,
          status,
          message,
          character_id,
          error,
          assets,
          updated_at::text
        FROM character_creation_jobs
        WHERE job_id = $1
        LIMIT 1
        `,
        [jobId],
      )
      if (result.rowCount === 0) return json(404, { error: 'Job nicht gefunden.' })
      return json(200, mapCharacterCreationJobRow(result.rows[0]))
    }

    if (routeKey === 'POST /api/character-creator/start') {
      const body = readJsonBodyFromEvent(event)
      const db = getPool()
      if (!db) return json(503, { error: 'DATABASE_URL fehlt.' })
      if (!CHARACTER_CREATION_QUEUE_URL) {
        return json(503, { error: 'CHARACTER_CREATION_QUEUE_URL fehlt.' })
      }

      const yamlText = readOptionalString(body.yamlText) || ''
      const prompt = readOptionalString(body.prompt) || ''
      const fillMissingFieldsCreatively = body.fillMissingFieldsCreatively === true
      const referenceImageIds = Array.isArray(body.referenceImageIds)
        ? body.referenceImageIds.filter((entry) => typeof entry === 'string')
        : []
      if (!yamlText && !prompt && !fillMissingFieldsCreatively && referenceImageIds.length === 0) {
        return json(400, {
          error: 'Bitte gib YAML, eine Character-Beschreibung oder nutze Skip and create.',
        })
      }

      await ensureCharacterCreationSchema(db)
      const idempotencyKey = deriveCharacterCreationIdempotencyKey(event, body)
      const existingResult = await db.query(
        `
        SELECT
          job_id,
          status,
          message,
          character_id,
          error,
          assets,
          updated_at::text
        FROM character_creation_jobs
        WHERE idempotency_key = $1
        LIMIT 1
        `,
        [idempotencyKey],
      )
      if (existingResult.rowCount > 0) {
        const existingJob = mapCharacterCreationJobRow(existingResult.rows[0])
        return json(202, {
          jobId: existingJob.id,
          reused: true,
          status: existingJob.status,
        })
      }

      const jobId = crypto.randomUUID()
      const nowIso = new Date().toISOString()
      const selectedReferenceImages = referenceImageIds.length
        ? (
            await db.query(
              `
              SELECT
                reference_image_id,
                storage_bucket,
                storage_key,
                file_name,
                mime_type,
                summary
              FROM character_creation_reference_images
              WHERE reference_image_id = ANY($1::text[])
              `,
              [referenceImageIds],
            )
          ).rows.map((row) => ({
            id: row.reference_image_id,
            bucket: row.storage_bucket,
            key: row.storage_key,
            fileName: row.file_name,
            mimeType: row.mime_type,
            summary: row.summary,
          }))
        : []
      const requestPayload = {
        prompt: prompt || undefined,
        yamlText: yamlText || undefined,
        fillMissingFieldsCreatively,
        referenceImageIds,
        referenceImages: selectedReferenceImages,
      }

      const client = await db.connect()
      try {
        await client.query('BEGIN')
        await client.query(
          `
          INSERT INTO character_creation_jobs (
            job_id,
            idempotency_key,
            status,
            phase,
            message,
            prompt,
            yaml_text,
            fill_missing_fields_creatively,
            reference_images,
            request_payload,
            created_at,
            updated_at
          ) VALUES (
            $1, $2, 'accepted', 'draft', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::timestamptz, $9::timestamptz
          )
          `,
          [
            jobId,
            idempotencyKey,
            'Job angelegt.',
            prompt || null,
            yamlText || null,
            fillMissingFieldsCreatively,
            JSON.stringify(selectedReferenceImages),
            JSON.stringify(requestPayload),
            nowIso,
          ],
        )
        await client.query(
          `
          INSERT INTO event_outbox (
            aggregate_type,
            aggregate_id,
            event_type,
            event_key,
            payload
          ) VALUES ($1, $2, $3, $4, $5::jsonb)
          `,
          [
            'character_creation_job',
            jobId,
            'job.accepted',
            `character_creation_job:${jobId}:job.accepted`,
            JSON.stringify({ jobId, status: 'accepted', createdAt: nowIso }),
          ],
        )
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }

      const sqs = getSqsClient()
      const sendResult = await sqs.send(
        new SendMessageCommand({
          QueueUrl: CHARACTER_CREATION_QUEUE_URL,
          MessageBody: JSON.stringify({ jobId, queuedAt: nowIso }),
        }),
      )
      await db.query(
        `
        UPDATE character_creation_jobs
        SET
          status = 'queued',
          message = $2,
          queued_at = NOW(),
          updated_at = NOW(),
          result_payload = jsonb_set(
            COALESCE(result_payload, '{}'::jsonb),
            '{queueMessageId}',
            to_jsonb($3::text),
            true
          )
        WHERE job_id = $1
        `,
        [jobId, 'Job in die Queue eingestellt.', sendResult.MessageId || null],
      )
      return json(202, { jobId, reused: false, status: 'queued' })
    }

    if (routeKey === 'POST /api/character-creator/chat') {
      const body = readJsonBodyFromEvent(event)
      const incomingMessages = Array.isArray(body.messages) ? body.messages : []
      const messages = incomingMessages
        .filter(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            typeof entry.role === 'string' &&
            typeof entry.content === 'string',
        )
        .map((entry) => ({
          role: entry.role === 'assistant' ? 'assistant' : 'user',
          content: entry.content.trim(),
        }))
        .filter((entry) => entry.content.length > 0)
      if (messages.length === 0) {
        return json(400, { error: 'Bitte sende mindestens eine Chat-Nachricht.' })
      }
      return json(200, buildFallbackChatReply(messages))
    }

    if (routeKey === 'POST /api/character-creator/reference-image') {
      if (!CONTENT_BUCKET) return json(503, { error: 'CONTENT_BUCKET fehlt.' })
      const db = getPool()
      if (!db) return json(503, { error: 'DATABASE_URL fehlt.' })
      await ensureCharacterCreationSchema(db)

      const body = readJsonBodyFromEvent(event)
      const dataUrl = readOptionalString(body.dataUrl) || ''
      const incomingFileName = readOptionalString(body.fileName) || 'reference-image.png'
      if (!dataUrl) {
        return json(400, { error: 'Bitte sende ein Bild zum Hochladen.' })
      }

      const { mimeType, buffer } = parseImageDataUrl(dataUrl)
      if (buffer.byteLength > 10 * 1024 * 1024) {
        return json(400, { error: 'Das Bild ist zu gross. Bitte waehle eine Datei unter 10 MB.' })
      }

      const referenceId = crypto.randomUUID()
      const safeName = safeFileName(incomingFileName)
      const storageKey = `tmp/character-creator/references/${referenceId}${extensionForMimeType(mimeType)}`
      await s3.send(
        new PutObjectCommand({
          Bucket: CONTENT_BUCKET,
          Key: storageKey,
          Body: buffer,
          ContentType: mimeType,
        }),
      )

      const summary = `Visuelle Referenz aus ${safeName}: Nutze dieses Bild als Hauptvorlage fuer Aussehen, Farben, Gesicht und Kleidung der Figur.`
      await db.query(
        `
        INSERT INTO character_creation_reference_images (
          reference_image_id,
          storage_bucket,
          storage_key,
          file_name,
          mime_type,
          summary,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `,
        [
          referenceId,
          CONTENT_BUCKET,
          storageKey,
          safeName,
          mimeType,
          summary,
          JSON.stringify({ uploadedAt: new Date().toISOString() }),
        ],
      )

      return json(200, {
        referenceImage: {
          id: referenceId,
          fileName: safeName,
          mimeType,
          previewDataUrl: dataUrl,
          summary,
        },
        reply:
          'Ich habe dein Bild gespeichert und nutze es als Aussehens-Vorlage. Magst du mir jetzt noch sagen, wie dein Character heisst und wie er so ist?',
      })
    }

    // Realtime (event-driven, ohne Conversations)
    if (routeKey === 'POST /api/realtime/events') {
      const body = readJsonBodyFromEvent(event)
      const characterId = readOptionalString(body.characterId)
      const correlationId = readOptionalString(body.correlationId) || crypto.randomUUID()
      const conversationKey = readOptionalString(body.conversationKey) || undefined
      const eventType = body.eventType

      if (!characterId) return json(400, { error: 'characterId ist erforderlich.' })
      if (!isRealtimeEventType(eventType)) return json(400, { error: 'eventType ist ungueltig.' })

      const envelope = buildRealtimeEventEnvelope({
        eventId: crypto.randomUUID(),
        correlationId,
        conversationKey,
        characterId,
        eventType,
        occurredAt: readOptionalString(body.occurredAt) || undefined,
        payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
      })
      await publishRealtimeEvent(envelope)
      return json(202, {
        accepted: true,
        eventId: envelope.eventId,
        correlationId: envelope.correlationId,
      })
    }

    if (routeKey === 'POST /api/realtime/instructions') {
      const body = readJsonBodyFromEvent(event)
      const characterId = readOptionalString(body.characterId)
      const correlationId = readOptionalString(body.correlationId) || crypto.randomUUID()
      const conversationKey = readOptionalString(body.conversationKey) || undefined

      if (!characterId) return json(400, { error: 'characterId ist erforderlich.' })

      const characterObject = await getObjectByIdOrSlug(characterId)
      if (!characterObject || characterObject.type !== 'character') {
        return json(404, { error: 'Character nicht gefunden.' })
      }

      const instructions = buildBasicVoiceInstructions(characterObject)
      const voice = resolveVoiceName(characterObject)
      const envelope = buildRealtimeEventEnvelope({
        eventId: crypto.randomUUID(),
        correlationId,
        conversationKey,
        characterId: characterObject.id,
        eventType: 'voice.instructions.updated',
        payload: {
          instructionLength: instructions.length,
          voice,
        },
      })
      await publishRealtimeEvent(envelope)
      return json(200, {
        instructions,
        voice,
        eventId: envelope.eventId,
        correlationId: envelope.correlationId,
      })
    }

    if (routeKey === 'POST /api/realtime/session') {
      const body = readJsonBodyFromEvent(event)
      const characterId = readOptionalString(body.characterId)
      const correlationId = readOptionalString(body.correlationId) || crypto.randomUUID()
      const conversationKey = readOptionalString(body.conversationKey) || undefined

      if (!characterId) return json(400, { error: 'characterId ist erforderlich.' })

      const characterObject = await getObjectByIdOrSlug(characterId)
      if (!characterObject || characterObject.type !== 'character') {
        return json(404, { error: 'Character nicht gefunden.' })
      }

      const runtimeConfig = await getRuntimeConfig()
      if (!runtimeConfig.openAiApiKey) {
        return json(503, { error: 'OPENAI_API_KEY fehlt in Runtime-Config.' })
      }

      const instructions = buildBasicVoiceInstructions(characterObject)
      const voice = resolveVoiceName(characterObject)
      const requestedEnvelope = buildRealtimeEventEnvelope({
        eventId: crypto.randomUUID(),
        correlationId,
        conversationKey,
        characterId: characterObject.id,
        eventType: 'voice.session.requested',
        payload: {
          voice,
          instructionLength: instructions.length,
        },
      })
      await publishRealtimeEvent(requestedEnvelope)
      try {
        const sessionToken = await createRealtimeSessionToken({
          openAiApiKey: runtimeConfig.openAiApiKey,
          instructions,
          voice,
        })
        return json(200, {
          token: sessionToken.token,
          expiresAt: sessionToken.expiresAt,
          correlationId,
          requestedEventId: requestedEnvelope.eventId,
        })
      } catch (error) {
        const failedEnvelope = buildRealtimeEventEnvelope({
          eventId: crypto.randomUUID(),
          correlationId,
          conversationKey,
          characterId: characterObject.id,
          eventType: 'voice.session.failed',
          payload: {
            reason: error instanceof Error ? error.message : String(error),
          },
        })
        await publishRealtimeEvent(failedEnvelope).catch(() => undefined)
        throw error
      }
    }

    return json(501, {
      error: 'Service noch nicht migriert.',
      routeKey,
      path,
      migrationMode: 'infra-ready',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return json(500, { error: message, routeKey, path })
  }
}
