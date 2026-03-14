import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sendMock: vi.fn(),
  readServerEnvMock: vi.fn(),
}))

vi.mock('@aws-sdk/client-eventbridge', () => {
  class PutEventsCommand {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }
  class EventBridgeClient {
    send = mocks.sendMock
  }
  return { EventBridgeClient, PutEventsCommand }
})

vi.mock('./openAiConfig.ts', () => ({
  readServerEnv: mocks.readServerEnvMock,
}))

const SAMPLE_ACTIVITY = {
  activityId: 'a1',
  activityType: 'conversation.image.generated',
  isPublic: true,
  characterId: 'c1',
  placeId: undefined,
  learningGoalIds: [],
  conversationId: 'conv1',
  subject: {},
  object: {},
  metadata: {},
  storySummary: 'summary',
  occurredAt: '2026-03-14T00:00:00.000Z',
  createdAt: '2026-03-14T00:00:00.000Z',
}

describe('activityEventBus', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.sendMock.mockResolvedValue({ FailedEntryCount: 0, Entries: [] })
    mocks.readServerEnvMock.mockImplementation((_name: string, fallback = '') => fallback)
  })

  it('publiziert nichts wenn disabled', async () => {
    const { publishActivityChange } = await import('./activityEventBus.ts')
    await publishActivityChange({
      change: 'created',
      activity: SAMPLE_ACTIVITY,
    })
    expect(mocks.sendMock).not.toHaveBeenCalled()
  })

  it('wirft bei strict mode mit fehlender Konfiguration', async () => {
    mocks.readServerEnvMock.mockImplementation((name: string, fallback = '') => {
      if (name === 'ACTIVITY_EVENTBRIDGE_ENABLED') return 'true'
      if (name === 'ACTIVITY_EVENTBRIDGE_STRICT') return 'true'
      return fallback
    })
    const { publishActivityChange } = await import('./activityEventBus.ts')
    await expect(
      publishActivityChange({
        change: 'created',
        activity: SAMPLE_ACTIVITY,
      }),
    ).rejects.toThrow(/EventBridge-Konfiguration fehlt/i)
    expect(mocks.sendMock).not.toHaveBeenCalled()
  })

  it('publiziert Event bei gueltiger Konfiguration', async () => {
    mocks.readServerEnvMock.mockImplementation((name: string, fallback = '') => {
      if (name === 'ACTIVITY_EVENTBRIDGE_ENABLED') return 'true'
      if (name === 'AWS_REGION') return 'eu-central-1'
      if (name === 'ACTIVITY_EVENTBRIDGE_BUS_NAME') return 'storytime-bus'
      return fallback
    })
    const { publishActivityChange } = await import('./activityEventBus.ts')
    await publishActivityChange({
      change: 'created',
      activity: SAMPLE_ACTIVITY,
    })
    expect(mocks.sendMock).toHaveBeenCalledTimes(1)
  })
})
