import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { readServerEnv } from './openAiConfig.ts'
import type { RealtimeEventEnvelope } from './realtimeEventContract.ts'

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
  const enabled = parseBoolean(readServerEnv('REALTIME_EVENTBRIDGE_ENABLED', 'false'))
  const strictMode = parseBoolean(readServerEnv('REALTIME_EVENTBRIDGE_STRICT', 'false'))
  const region = readServerEnv('AWS_REGION', '')
  const busName =
    readServerEnv('REALTIME_EVENTBRIDGE_BUS_NAME', '') ||
    readServerEnv('ACTIVITY_EVENTBRIDGE_BUS_NAME', '')
  const source = readServerEnv('REALTIME_EVENTBRIDGE_SOURCE', 'storytime.realtime')
  const detailTypePrefix = readServerEnv(
    'REALTIME_EVENTBRIDGE_DETAIL_TYPE_PREFIX',
    'storytime.voice',
  )
  const endpoint = readServerEnv('REALTIME_EVENTBRIDGE_ENDPOINT', '') || undefined
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

const toDetailType = (prefix: string, eventType: string): string => {
  const normalizedPrefix = prefix.trim() || 'storytime.voice'
  return `${normalizedPrefix}.${eventType}`
}

export const publishRealtimeEvent = async (event: RealtimeEventEnvelope): Promise<void> => {
  const config = readConfig()
  if (!config.enabled) return

  if (!config.region || !config.busName) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true
      console.warn(
        '[realtime-eventbridge] REALTIME_EVENTBRIDGE_ENABLED=true, aber AWS_REGION oder REALTIME_EVENTBRIDGE_BUS_NAME fehlt.',
      )
    }
    if (config.strictMode) {
      throw new Error(
        'EventBridge-Konfiguration fehlt (AWS_REGION oder REALTIME_EVENTBRIDGE_BUS_NAME).',
      )
    }
    return
  }

  const client = resolveClient(config)
  const command = new PutEventsCommand({
    Entries: [
      {
        EventBusName: config.busName,
        Source: config.source,
        DetailType: toDetailType(config.detailTypePrefix, event.eventType),
        Time: new Date(event.occurredAt),
        Detail: JSON.stringify(event),
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
      throw new Error(`Realtime EventBridge publish fehlgeschlagen: ${message}`)
    }
    console.warn(`[realtime-eventbridge] Publish fehlgeschlagen: ${message}`)
  }
}
