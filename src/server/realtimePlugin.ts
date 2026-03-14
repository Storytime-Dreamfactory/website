import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { getConversationDetails, type ConversationDetailsRecord } from './conversationStore.ts'
import { getOpenAiApiKey } from './openAiConfig.ts'
import * as gameObjectService from './gameObjectService.ts'
import {
  buildCharacterVoiceSessionContext,
  buildVoiceProfileInstructionsBlock,
  resolveRealtimeVoiceFromCharacterYaml,
} from './characterVoiceResponseService.ts'

const REALTIME_VAD_SILENCE_DURATION_MS = 900

type MiddlewareStack = {
  use: (
    route: string,
    handler: (
      request: IncomingMessage,
      response: ServerResponse,
      next: (error?: unknown) => void,
    ) => void | Promise<void>,
  ) => void
}

const json = (response: ServerResponse, statusCode: number, data: unknown): void => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(data))
}

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

export { resolveRealtimeVoiceFromCharacterYaml, buildVoiceProfileInstructionsBlock }

const createEphemeralToken = async (
  instructions: string,
  voice: string,
): Promise<{ token: string; expiresAt: number }> => {
  const realtimeTools = [
    {
      type: 'function',
      name: 'unmute_user_microphone',
      description:
        'Entstummt das Mikrofon des Kindes nach deiner Antwort, damit es wieder sprechen kann.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  ]
  const response = await fetch('https://api.openai.com/v1/realtime/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getOpenAiApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-realtime',
      voice,
      instructions,
      tools: realtimeTools,
      input_audio_transcription: { model: 'gpt-4o-mini-transcribe' },
      turn_detection: {
        type: 'server_vad',
        create_response: true,
        interrupt_response: false,
        silence_duration_ms: REALTIME_VAD_SILENCE_DURATION_MS,
      },
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI session creation failed (${response.status}): ${body}`)
  }

  const data = (await response.json()) as {
    client_secret: { value: string; expires_at: number }
  }
  return {
    token: data.client_secret.value,
    expiresAt: data.client_secret.expires_at,
  }
}

const registerRealtimeApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/realtime', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')

      if (request.method !== 'POST' || requestUrl.pathname !== '/session') {
        if (request.method === 'POST' && requestUrl.pathname === '/instructions') {
          const body = await readJsonBody(request)
          const characterId = typeof body.characterId === 'string' ? body.characterId.trim() : ''
          const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''

          if (!characterId) {
            json(response, 400, { error: 'characterId ist erforderlich.' })
            return
          }

          let conversationDetails: ConversationDetailsRecord | null = null
          if (conversationId) {
            conversationDetails = await getConversationDetails(conversationId)
          }

          const voiceContext = await buildCharacterVoiceSessionContext({
            characterId,
            conversationDetails,
          })
          json(response, 200, {
            instructions: voiceContext.fullInstructions,
            voice: voiceContext.voice,
          })
          return
        }

        next()
        return
      }

      if (!getOpenAiApiKey()) {
        json(response, 400, {
          error: 'OPENAI_API_KEY fehlt. Bitte in .env setzen.',
        })
        return
      }

      const body = await readJsonBody(request)
      const characterId = typeof body.characterId === 'string' ? body.characterId.trim() : ''
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : ''

      if (!characterId) {
        json(response, 400, { error: 'characterId ist erforderlich.' })
        return
      }

      const characterObject = await gameObjectService.get(characterId)
      if (!characterObject || characterObject.type !== 'character') {
        json(response, 404, { error: 'Character nicht gefunden.' })
        return
      }

      let conversationDetails: ConversationDetailsRecord | null = null
      if (conversationId) {
        conversationDetails = await getConversationDetails(conversationId)
        if (conversationDetails.conversation.characterId !== characterObject.id) {
          json(response, 400, {
            error: 'conversationId passt nicht zum angefragten Character.',
          })
          return
        }
      }

      const voiceContext = await buildCharacterVoiceSessionContext({
        characterId: characterObject.id,
        conversationDetails,
      })
      const { token, expiresAt } = await createEphemeralToken(
        voiceContext.fullInstructions,
        voiceContext.voice,
      )

      const sessionPayload: Record<string, unknown> = { token, expiresAt }
      if (voiceContext.lastSceneImage) {
        sessionPayload.lastSceneImage = {
          base64: voiceContext.lastSceneImage.base64,
          mimeType: voiceContext.lastSceneImage.mimeType,
          summary: voiceContext.lastSceneImage.sceneSummary,
        }
      }
      json(response, 200, sessionPayload)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = message.includes('ENOENT') ? 404 : 500
      json(response, status, { error: message })
    }
  })
}

export const realtimeApiPlugin = (): Plugin => ({
  name: 'storytime-realtime-api',
  configureServer(server) {
    registerRealtimeApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerRealtimeApi(server.middlewares)
  },
})
