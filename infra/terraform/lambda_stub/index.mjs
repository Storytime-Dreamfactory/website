import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import crypto from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import pg from 'pg'

const { Pool } = pg
const s3 = new S3Client({})
const secretsManager = new SecretsManagerClient({})

const CONTENT_BUCKET = process.env.CONTENT_BUCKET || ''
const RUNTIME_SECRET_ARN = process.env.RUNTIME_SECRET_ARN || ''
const AWS_REGION = process.env.AWS_REGION || 'eu-central-1'

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
let runtimeConfigPromise = null
let runtimeConfigCachedAt = 0
const RUNTIME_CONFIG_CACHE_TTL_MS = 60_000
let cachedDatabaseUrl = process.env.DATABASE_URL || ''

const json = (statusCode, data) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
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
    if (routeKey === 'GET /api/activities') {
      const payload = await listActivities(requestUrl)
      return json(200, payload)
    }
    if (routeKey === 'GET /api/activities/stream') {
      return json(501, {
        error: 'Stream noch nicht migriert. Nutze vorerst GET /api/activities Polling.',
        migrationMode: 'stream-degraded',
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
