type RuntimeTurn = {
  role: 'user' | 'assistant'
  content: string
  eventType?: string
}

type ConversationStartResponse = {
  conversation?: {
    conversationId?: string
  }
}

type ActivitiesResponse = {
  activities?: Array<{
    activityType?: string
    metadata?: Record<string, unknown>
  }>
}

type ConversationDetailsResponse = {
  conversation?: {
    conversationId?: string
  }
  messages?: Array<{
    role?: string
    content?: string
    eventType?: string
  }>
}

const DEFAULT_BASE_URL = 'http://localhost:5173'
const DEFAULT_CHARACTER_ID = 'yoko'
const DEFAULT_LEARNING_GOAL_IDS = ['kindness']
const DEFAULT_PLACE_ID = 'story-garden'
const DEFAULT_USER_ID = 'runtime-smoke-user'

const parseArg = (name: string): string | undefined => {
  const token = `--${name}=`
  const match = process.argv.find((entry) => entry.startsWith(token))
  return match ? match.slice(token.length).trim() : undefined
}

const toList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) return fallback
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : fallback
}

const postJson = async <T>(baseUrl: string, path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const data = text ? (JSON.parse(text) as T) : ({} as T)
  if (!response.ok) {
    throw new Error(`POST ${path} failed (${response.status}): ${text}`)
  }
  return data
}

const getJson = async <T>(baseUrl: string, path: string): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`)
  const text = await response.text()
  const data = text ? (JSON.parse(text) as T) : ({} as T)
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status}): ${text}`)
  }
  return data
}

const buildScenario = (mode: string): RuntimeTurn[] => {
  if (mode === 'visual') {
    return [
      {
        role: 'user',
        content: 'Kannst du mir bitte ein Bild mit einem freundlichen Drachen zeigen?',
        eventType: 'chat.turn',
      },
      {
        role: 'assistant',
        content: 'Ich zeige dir jetzt: einen kleinen Drachen, der einem Kaefer hilft.',
        eventType: 'response.audio_transcript.done',
      },
    ]
  }

  if (mode === 'quiz') {
    return [
      {
        role: 'user',
        content: 'Koennen wir ein kleines Quiz dazu machen?',
        eventType: 'chat.turn',
      },
      {
        role: 'assistant',
        content: 'Super, ich habe eine kleine Frage fuer dich.',
        eventType: 'response.audio_transcript.done',
      },
    ]
  }

  if (mode === 'context') {
    return [
      {
        role: 'user',
        content: 'Wer sind eigentlich deine Freunde und kannst du mich danach quizzen?',
        eventType: 'chat.turn',
      },
      {
        role: 'assistant',
        content: 'Klar, ich denke an meine Freunde und habe gleich eine Frage fuer dich.',
        eventType: 'response.audio_transcript.done',
      },
    ]
  }

  if (mode === 'memory-image') {
    return [
      {
        role: 'user',
        content: 'Kannst du mir bitte ein Bild vom Wald zeigen?',
        eventType: 'chat.turn',
      },
      {
        role: 'assistant',
        content: 'Ich zeige dir jetzt: einen ruhigen Wald mit kleinem See.',
        eventType: 'response.audio_transcript.done',
      },
      {
        role: 'user',
        content: 'Kannst du dich erinnern wo wir waren und das Bild von damals zeigen?',
        eventType: 'chat.turn',
      },
      {
        role: 'assistant',
        content: 'Ja, ich erinnere mich an unseren Ort.',
        eventType: 'response.audio_transcript.done',
      },
    ]
  }

  return [
    {
      role: 'user',
      content: 'Kannst du mir etwas zeigen und danach ein kleines Quiz machen?',
      eventType: 'chat.turn',
    },
    {
      role: 'assistant',
      content: 'Ich zeige dir jetzt: eine freundliche Szene und danach kommt eine Frage.',
      eventType: 'response.audio_transcript.done',
    },
  ]
}

const summarizeActivities = (activities: ActivitiesResponse['activities']): string[] => {
  const counter = new Map<string, number>()
  for (const entry of activities ?? []) {
    const key = typeof entry.activityType === 'string' ? entry.activityType : 'unknown'
    counter.set(key, (counter.get(key) ?? 0) + 1)
  }
  return [...counter.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([type, count]) => `${type}: ${count}`)
}

const run = async (): Promise<void> => {
  const baseUrl = parseArg('base-url') || DEFAULT_BASE_URL
  const characterId = parseArg('character') || DEFAULT_CHARACTER_ID
  const learningGoalIds = toList(parseArg('learning-goals'), DEFAULT_LEARNING_GOAL_IDS)
  const placeId = parseArg('place') || DEFAULT_PLACE_ID
  const userId = parseArg('user-id') || DEFAULT_USER_ID
  const mode = parseArg('mode') || 'smoke'

  console.log(`Runtime smoke test -> baseUrl=${baseUrl}, mode=${mode}, character=${characterId}`)
  const start = await postJson<ConversationStartResponse>(baseUrl, '/api/conversations/start', {
    characterId,
    userId,
    metadata: {
      placeId,
      learningGoalIds,
      channel: 'runtime-smoke-cli',
    },
  })

  const conversationId = start.conversation?.conversationId?.trim()
  if (!conversationId) {
    throw new Error('No conversationId received from /api/conversations/start.')
  }
  console.log(`conversationId=${conversationId}`)

  const turns = buildScenario(mode)
  for (const turn of turns) {
    await postJson(baseUrl, '/api/conversations/message', {
      conversationId,
      role: turn.role,
      content: turn.content,
      eventType: turn.eventType,
    })
  }

  if (mode === 'quiz' || mode === 'context') {
    await postJson(baseUrl, '/api/tools/run-learning-goal-quiz', {
      conversationId,
      learningGoalId: learningGoalIds[0],
    })
  }

  if (mode === 'memory-image') {
    await postJson(baseUrl, '/api/tools/display-existing-image', {
      conversationId,
      queryText: 'wo wir waren bild von damals',
    })
  }

  const details = await getJson<ConversationDetailsResponse>(
    baseUrl,
    `/api/conversations/?conversationId=${encodeURIComponent(conversationId)}`,
  )
  const activities = await getJson<ActivitiesResponse>(
    baseUrl,
    `/api/activities/?includeNonPublic=true&conversationId=${encodeURIComponent(conversationId)}&limit=200`,
  )

  const lines = summarizeActivities(activities.activities)
  console.log('\nActivity summary:')
  for (const line of lines) {
    console.log(`- ${line}`)
  }

  console.log('\nRecent messages:')
  for (const message of (details.messages ?? []).slice(-8)) {
    const role = message.role ?? 'unknown'
    const eventType = message.eventType ? ` (${message.eventType})` : ''
    const content = (message.content ?? '').replace(/\s+/g, ' ').trim()
    console.log(`- ${role}${eventType}: ${content}`)
  }

  await postJson(baseUrl, '/api/conversations/end', {
    conversationId,
    metadata: {
      endReason: 'runtime-smoke-cli',
    },
  })
  console.log('\nConversation ended successfully.')
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Runtime smoke test failed: ${message}`)
  console.error('Hint: Ensure `npm run dev` and local DB are running.')
  process.exitCode = 1
})
