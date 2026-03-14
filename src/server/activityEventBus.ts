import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { readServerEnv } from './openAiConfig.ts'

type ActivityChangeType = 'created' | 'updated'

type ActivityEventRecord = {
  activityId: string
  activityType: string
  isPublic: boolean
  characterId?: string
  placeId?: string
  learningGoalIds: string[]
  conversationId?: string
  subject: Record<string, unknown>
  object: Record<string, unknown>
  metadata: Record<string, unknown>
  storySummary?: string
  occurredAt: string
  createdAt: string
}

type PublishActivityChangeInput = {
  change: ActivityChangeType
  activity: ActivityEventRecord
}

type EventBridgeRuntimeConfig = {
  enabled: boolean
  strictMode: boolean
  region: string
  busName: string
  source: string
  detailTypePrefix: string
  endpoint?: string
}

let cachedClient: EventBridgeClient | null = null
let warnedMissingConfig = false

const parseBoolean = (value: string): boolean => {
  const normalized = value.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

const readConfig = (): EventBridgeRuntimeConfig => {
  const enabled = parseBoolean(readServerEnv('ACTIVITY_EVENTBRIDGE_ENABLED', 'false'))
  const strictMode = parseBoolean(readServerEnv('ACTIVITY_EVENTBRIDGE_STRICT', 'false'))
  const region = readServerEnv('AWS_REGION', '')
  const busName = readServerEnv('ACTIVITY_EVENTBRIDGE_BUS_NAME', '')
  const source = readServerEnv('ACTIVITY_EVENTBRIDGE_SOURCE', 'storytime.activities')
  const detailTypePrefix = readServerEnv('ACTIVITY_EVENTBRIDGE_DETAIL_TYPE_PREFIX', 'storytime.activity')
  const endpoint = readServerEnv('ACTIVITY_EVENTBRIDGE_ENDPOINT', '') || undefined
  return {
    enabled,
    strictMode,
    region,
    busName,
    source,
    detailTypePrefix,
    endpoint,
  }
}

const resolveClient = (config: EventBridgeRuntimeConfig): EventBridgeClient => {
  if (cachedClient) return cachedClient
  cachedClient = new EventBridgeClient({
    region: config.region,
    endpoint: config.endpoint,
  })
  return cachedClient
}

const toDetailType = (prefix: string, change: ActivityChangeType): string => {
  const normalizedPrefix = prefix.trim() || 'storytime.activity'
  return `${normalizedPrefix}.${change}`
}

export const publishActivityChange = async (input: PublishActivityChangeInput): Promise<void> => {
  const config = readConfig()
  if (!config.enabled) return

  if (!config.region || !config.busName) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true
      console.warn(
        '[activity-eventbridge] ACTIVITY_EVENTBRIDGE_ENABLED=true, aber AWS_REGION oder ACTIVITY_EVENTBRIDGE_BUS_NAME fehlt.',
      )
    }
    if (config.strictMode) {
      throw new Error('EventBridge-Konfiguration fehlt (AWS_REGION oder ACTIVITY_EVENTBRIDGE_BUS_NAME).')
    }
    return
  }

  const client = resolveClient(config)
  const detail = {
    change: input.change,
    emittedAt: new Date().toISOString(),
    activity: input.activity,
  }
  const command = new PutEventsCommand({
    Entries: [
      {
        EventBusName: config.busName,
        Source: config.source,
        DetailType: toDetailType(config.detailTypePrefix, input.change),
        Detail: JSON.stringify(detail),
      },
    ],
  })

  try {
    const result = await client.send(command)
    const failedCount = Number(result.FailedEntryCount ?? 0)
    if (failedCount > 0) {
      const message = result.Entries?.[0]?.ErrorMessage || 'Unbekannter PutEvents-Fehler'
      throw new Error(message)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (config.strictMode) {
      throw new Error(`EventBridge publish fehlgeschlagen: ${message}`)
    }
    console.warn(`[activity-eventbridge] Publish fehlgeschlagen: ${message}`)
  }
}
