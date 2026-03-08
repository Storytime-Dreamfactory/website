import { Pool } from 'pg'
import { randomUUID } from 'node:crypto'

const POSTGRES_DEFAULT_URL = 'postgres://storytime:storytime@localhost:5433/storytime'
const ALLOWED_MESSAGE_ROLES = new Set(['user', 'assistant', 'system'])

export type ConversationMetadata = Record<string, unknown>

export type ConversationRecord = {
  conversationId: string
  userId?: string
  characterId: string
  startedAt: string
  endedAt?: string
  metadata?: ConversationMetadata
}

export type ConversationMessageRecord = {
  messageId: number
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  eventType?: string
  createdAt: string
  metadata?: ConversationMetadata
}

type ConversationRow = {
  conversation_id: string
  user_id: string | null
  character_id: string
  started_at: string
  ended_at: string | null
  metadata: ConversationMetadata | null
}

type ConversationMessageRow = {
  message_id: number
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  event_type: string | null
  created_at: string
  metadata: ConversationMetadata | null
}

let pool: Pool | null = null
let schemaEnsurePromise: Promise<void> | null = null

const getPool = (): Pool => {
  if (pool) return pool

  const connectionString = process.env.DATABASE_URL?.trim() || POSTGRES_DEFAULT_URL
  pool = new Pool({ connectionString })
  return pool
}

const ensureSchemaReady = async (): Promise<void> => {
  if (!schemaEnsurePromise) {
    schemaEnsurePromise = ensureConversationTables().then(() => undefined)
  }
  await schemaEnsurePromise
}

const toConversationRecord = (row: ConversationRow): ConversationRecord => ({
  conversationId: row.conversation_id,
  userId: row.user_id ?? undefined,
  characterId: row.character_id,
  startedAt: new Date(row.started_at).toISOString(),
  endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : undefined,
  metadata: row.metadata ?? undefined,
})

const toConversationMessageRecord = (row: ConversationMessageRow): ConversationMessageRecord => ({
  messageId: row.message_id,
  conversationId: row.conversation_id,
  role: row.role,
  content: row.content,
  eventType: row.event_type ?? undefined,
  createdAt: new Date(row.created_at).toISOString(),
  metadata: row.metadata ?? undefined,
})

const normalizeMetadata = (metadata: ConversationMetadata | undefined): ConversationMetadata =>
  metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}

export const startConversation = async (input: {
  characterId: string
  userId?: string
  metadata?: ConversationMetadata
}): Promise<ConversationRecord> => {
  await ensureSchemaReady()

  const characterId = input.characterId.trim()
  if (!characterId) {
    throw new Error('characterId ist erforderlich.')
  }

  const conversationId = randomUUID()
  const userId = input.userId?.trim() || null
  const metadata = normalizeMetadata(input.metadata)

  const db = getPool()
  const result = await db.query<ConversationRow>(
    `
    INSERT INTO conversations (
      conversation_id,
      user_id,
      character_id,
      metadata
    )
    VALUES ($1, $2, $3, $4::jsonb)
    RETURNING
      conversation_id,
      user_id,
      character_id,
      started_at::text,
      ended_at::text,
      metadata
    `,
    [conversationId, userId, characterId, JSON.stringify(metadata)],
  )

  return toConversationRecord(result.rows[0])
}

export const appendConversationMessage = async (input: {
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  eventType?: string
  metadata?: ConversationMetadata
}): Promise<ConversationMessageRecord> => {
  await ensureSchemaReady()

  const conversationId = input.conversationId.trim()
  const role = input.role.trim().toLowerCase()
  const content = input.content.trim()
  const eventType = input.eventType?.trim() || null

  if (!conversationId) {
    throw new Error('conversationId ist erforderlich.')
  }
  if (!ALLOWED_MESSAGE_ROLES.has(role)) {
    throw new Error('role muss user, assistant oder system sein.')
  }
  if (!content) {
    throw new Error('content ist erforderlich.')
  }

  const metadata = normalizeMetadata(input.metadata)
  const db = getPool()
  const result = await db.query<ConversationMessageRow>(
    `
    INSERT INTO conversation_messages (
      conversation_id,
      role,
      content,
      event_type,
      metadata
    )
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING
      message_id,
      conversation_id,
      role,
      content,
      event_type,
      created_at::text,
      metadata
    `,
    [conversationId, role, content, eventType, JSON.stringify(metadata)],
  )

  return toConversationMessageRecord(result.rows[0])
}

export const endConversation = async (
  conversationId: string,
  options: { metadata?: ConversationMetadata } = {},
): Promise<ConversationRecord> => {
  await ensureSchemaReady()

  const normalizedConversationId = conversationId.trim()
  if (!normalizedConversationId) {
    throw new Error('conversationId ist erforderlich.')
  }

  const metadata = normalizeMetadata(options.metadata)
  const db = getPool()
  const result = await db.query<ConversationRow>(
    `
    UPDATE conversations
    SET
      ended_at = COALESCE(ended_at, NOW()),
      metadata = conversations.metadata || $2::jsonb
    WHERE conversation_id = $1
    RETURNING
      conversation_id,
      user_id,
      character_id,
      started_at::text,
      ended_at::text,
      metadata
    `,
    [normalizedConversationId, JSON.stringify(metadata)],
  )

  if (result.rowCount === 0) {
    throw new Error(`conversation ${normalizedConversationId} nicht gefunden.`)
  }

  return toConversationRecord(result.rows[0])
}

export const ensureConversationTables = async (): Promise<{
  conversationsTableCreated: boolean
  messagesTableCreated: boolean
}> => {
  const db = getPool()
  const existsResult = await db.query<{
    conversations_exists: boolean
    messages_exists: boolean
  }>(
    `
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'conversations'
      ) AS conversations_exists,
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'conversation_messages'
      ) AS messages_exists
    `,
  )

  const existedBefore = existsResult.rows[0] ?? {
    conversations_exists: false,
    messages_exists: false,
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      conversation_id TEXT PRIMARY KEY,
      user_id TEXT,
      character_id TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      message_id BIGSERIAL PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      event_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_character_id
      ON conversations (character_id);

    CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation
      ON conversation_messages (conversation_id);

    CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at
      ON conversation_messages (created_at DESC);
  `)

  return {
    conversationsTableCreated: !existedBefore.conversations_exists,
    messagesTableCreated: !existedBefore.messages_exists,
  }
}
