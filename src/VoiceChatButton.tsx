import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  AudioMutedOutlined,
  AudioOutlined,
  CloseOutlined,
  LoadingOutlined,
  MessageOutlined,
  SendOutlined,
} from '@ant-design/icons'
import type { Character } from './content/types'
import ChatPanel from './ChatPanel'
import type { ChatMessage } from './ChatPanel'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error'

type Props = {
  character: Character
  conversationId?: string | null
  onConversationActivated?: (conversationId: string) => void
  selectedLearningGoalId?: string | null
  enableTextChat?: boolean
  textChatMountSelector?: string
}
const VOICE_SPEAKER_EVENT = 'storytime:voice-speaker'

const isAssistantResponseStartEvent = (eventType: string): boolean => {
  return (
    eventType === 'output_audio_buffer.started' ||
    eventType === 'response.audio.delta' ||
    eventType === 'response.output_audio.delta'
  )
}

const isAssistantResponseStopEvent = (eventType: string): boolean => {
  return (
    eventType === 'output_audio_buffer.stopped' ||
    eventType === 'response.audio.done' ||
    eventType === 'response.output_audio.done'
  )
}

const isAssistantQuestion = (transcript: string): boolean => {
  const normalized = transcript.trim()
  if (!normalized) return false
  return normalized.includes('?')
}

const DEBUG_ENDPOINT = 'http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6'
const DEBUG_SESSION_ID = '16d83f'
const DEBUG_RUN_ID = 'pre-fix'
const REMOTE_SPEECH_START_THRESHOLD = 0.03
const REMOTE_SPEECH_STOP_THRESHOLD = 0.015
const REMOTE_MIN_SPEAK_MS = 120
const REMOTE_MIN_SILENCE_MS = 320
const ASSISTANT_STOP_FALLBACK_MS = 900
const SCENE_GATE_TIMEOUT_MS = 30_000

const REALTIME_TOOL_UNMUTE = {
  type: 'function' as const,
  name: 'unmute_user_microphone',
  description:
    'Entstummt das Mikrofon des Kindes nach deiner Antwort, damit es wieder sprechen kann.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}
const REALTIME_TOOL_READ_RELATIONSHIPS = {
  type: 'function' as const,
  name: 'read_relationships',
  description:
    'Liest das aktuelle Beziehungsnetzwerk der Figur inklusive verknuepfter Charaktere fuer konsistente Antworten.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
}
const REALTIME_TOOL_READ_ACTIVITIES = {
  type: 'function' as const,
  name: 'read_activities',
  description:
    'Liest oeffentliche Activities und Story-Zusammenfassungen aus dem bisherigen Verlauf der Figur, um Erinnerungsfragen belegbar zu beantworten.',
  parameters: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Maximale Anzahl von Eintraegen (1-50).' },
      scope: {
        type: 'string',
        enum: ['external', 'all'],
        description: 'external = nur oeffentliche Story-Activities, all = inkl. technischer Activities.',
      },
    },
    additionalProperties: false,
  },
}
const REALTIME_TOOLS_ALL = [REALTIME_TOOL_UNMUTE, REALTIME_TOOL_READ_RELATIONSHIPS, REALTIME_TOOL_READ_ACTIVITIES]
const REALTIME_TOOLS_WITHOUT_UNMUTE = [REALTIME_TOOL_READ_RELATIONSHIPS, REALTIME_TOOL_READ_ACTIVITIES]

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const sendDebugLog = (
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>,
): void => {
  // #region agent log
  fetch(DEBUG_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': DEBUG_SESSION_ID,
    },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId: DEBUG_RUN_ID,
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {})
  // #endregion
}

export default function VoiceChatButton({
  character,
  conversationId,
  onConversationActivated,
  selectedLearningGoalId,
  enableTextChat = false,
  textChatMountSelector,
}: Props) {
  const [state, setState] = useState<ConnectionState>('idle')
  const [audioLevel, setAudioLevel] = useState(0)
  const [isMicMutedByAssistant, setIsMicMutedByAssistant] = useState(false)
  const [isTextChatOpen, setIsTextChatOpen] = useState(false)
  const [textInputValue, setTextInputValue] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [localConversationId, setLocalConversationId] = useState<string | null>(
    conversationId?.trim() || null,
  )
  const [resolvedTextChatMountNode, setResolvedTextChatMountNode] = useState<Element | null>(null)
  const selectedVoice = useMemo(() => character.voice, [character.voice])
  const resolvedConversationId = useMemo(
    () => conversationId?.trim() || localConversationId,
    [conversationId, localConversationId],
  )
  const activeLearningGoalId = useMemo(() => {
    const trimmed = selectedLearningGoalId?.trim() ?? ''
    return UUID_LIKE_RE.test(trimmed) ? trimmed : null
  }, [selectedLearningGoalId])
  useEffect(() => {
    if (!enableTextChat || !textChatMountSelector || typeof document === 'undefined') {
      setResolvedTextChatMountNode(null)
      return
    }
    const resolveNode = () => {
      setResolvedTextChatMountNode(document.querySelector(textChatMountSelector))
    }
    resolveNode()
    const rafId = window.requestAnimationFrame(resolveNode)
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [enableTextChat, textChatMountSelector])

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const localAudioContextRef = useRef<AudioContext | null>(null)
  const remoteAudioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)
  const remoteRafRef = useRef<number>(0)
  const fallbackResetTimerRef = useRef<number | null>(null)
  const connectionResetTimerRef = useRef<number | null>(null)
  const assistantStopFallbackTimerRef = useRef<number | null>(null)
  const assistantAudioExpectedRef = useRef(false)
  const characterSpeakingRef = useRef(false)
  const speechCandidateStartedAtRef = useRef<number | null>(null)
  const silenceCandidateStartedAtRef = useRef<number | null>(null)
  const lastRemoteSpeechAtRef = useRef<number>(0)
  const sessionCorrelationIdRef = useRef<string | null>(null)
  const activeConversationIdRef = useRef<string | null>(resolvedConversationId)
  const creatingConversationPromiseRef = useRef<Promise<string> | null>(null)
  const knownEventIdsRef = useRef<Set<string>>(new Set())
  const recoverySentForCurrentTurnRef = useRef(false)
  const sceneGeneratingRef = useRef(false)
  const pendingUnmuteRef = useRef(false)
  const sceneGateTimeoutRef = useRef<number | null>(null)
  const queuedTextMessagesRef = useRef<string[]>([])
  const nextChatMessageIdRef = useRef(0)
  const makeChatMessageId = useCallback(() => {
    nextChatMessageIdRef.current += 1
    return `${Date.now()}-${nextChatMessageIdRef.current}`
  }, [])
  const addChatMessage = useCallback((role: 'user' | 'assistant', text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setChatMessages((prev) => [...prev, { id: makeChatMessageId(), role, text: trimmed }])
  }, [makeChatMessageId])

  useEffect(() => {
    activeConversationIdRef.current = resolvedConversationId
    if (resolvedConversationId) {
      setLocalConversationId((current) => (current === resolvedConversationId ? current : resolvedConversationId))
    }
  }, [resolvedConversationId])

  const emitSpeakerState = useCallback((speaker: 'yoko' | 'character', isSpeaking: boolean) => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(
      new CustomEvent(VOICE_SPEAKER_EVENT, {
        detail: {
          characterId: character.id,
          speaker,
          isSpeaking,
        },
      }),
    )
  }, [character.id])

  const publishRealtimeEvent = useCallback(
    async (
      eventType:
        | 'voice.session.ended'
        | 'voice.session.failed'
        | 'voice.user.transcript.received'
        | 'voice.assistant.transcript.received',
      payload: Record<string, unknown>,
    ) => {
      const correlationId = sessionCorrelationIdRef.current
      if (!correlationId) return
      await fetch('/api/realtime/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: character.id,
          correlationId,
          conversationId: activeConversationIdRef.current ?? undefined,
          eventType,
          payload,
        }),
      }).catch(() => undefined)
    },
    [character.id],
  )

  const executeRealtimeToolCall = useCallback(
    async (input: {
      toolName: string
      args: Record<string, unknown>
    }): Promise<Record<string, unknown>> => {
      const response = await fetch('/api/realtime/tool-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: character.id,
          conversationId: activeConversationIdRef.current ?? undefined,
          toolName: input.toolName,
          arguments: input.args,
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Tool call fehlgeschlagen (${response.status})`)
      }
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean
        result?: Record<string, unknown>
      }
      if (!payload.ok) {
        throw new Error('Tool call ohne Ergebnis.')
      }
      return payload.result ?? {}
    },
    [character.id],
  )

  const ensureConversationId = useCallback(async (): Promise<string> => {
    const currentConversationId = activeConversationIdRef.current?.trim() ?? ''
    if (currentConversationId) return currentConversationId
    if (creatingConversationPromiseRef.current) {
      return creatingConversationPromiseRef.current
    }

    const promise = fetch('/api/conversations/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        characterId: character.id,
        metadata: activeLearningGoalId ? { learningGoalIds: [activeLearningGoalId] } : undefined,
      }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Conversation konnte nicht gestartet werden (${response.status})`)
        }
        const payload = (await response.json()) as {
          conversation?: { conversationId?: string }
        }
        const createdConversationId = payload.conversation?.conversationId?.trim() ?? ''
        if (!createdConversationId) {
          throw new Error('Conversation API lieferte keine conversationId.')
        }
        activeConversationIdRef.current = createdConversationId
        setLocalConversationId(createdConversationId)
        onConversationActivated?.(createdConversationId)
        return createdConversationId
      })
      .finally(() => {
        creatingConversationPromiseRef.current = null
      })

    creatingConversationPromiseRef.current = promise
    return promise
  }, [activeLearningGoalId, character.id, onConversationActivated])

  const sendFunctionCallOutput = useCallback((callId: string, output: Record<string, unknown>) => {
    if (!callId) return
    const dc = dataChannelRef.current
    if (dc?.readyState !== 'open') return
    dc.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(output),
        },
      }),
    )
  }, [])

  const updateSessionTools = useCallback((tools: typeof REALTIME_TOOLS_ALL) => {
    const dc = dataChannelRef.current
    if (dc?.readyState !== 'open') return
    dc.send(JSON.stringify({ type: 'session.update', session: { tools } }))
  }, [])

  const setLocalMicEnabled = useCallback((
    enabled: boolean,
    context: { reason: string; hypothesisId: string; eventType?: string },
  ) => {
    const stream = localStreamRef.current
    const tracks = stream?.getAudioTracks() ?? []
    const before = tracks.map((track) => ({
      id: track.id,
      enabled: track.enabled,
      readyState: track.readyState,
    }))
    if (!stream || tracks.length === 0) {
      // #region agent log
      sendDebugLog(context.hypothesisId, 'VoiceChatButton.tsx:setLocalMicEnabled', 'No local audio tracks available', {
        requestedEnabled: enabled,
        reason: context.reason,
        eventType: context.eventType ?? '',
      })
      // #endregion
      return
    }
    tracks.forEach((track) => {
      track.enabled = enabled
    })
    const after = tracks.map((track) => ({
      id: track.id,
      enabled: track.enabled,
      readyState: track.readyState,
    }))
    // #region agent log
    sendDebugLog(context.hypothesisId, 'VoiceChatButton.tsx:setLocalMicEnabled', 'Updated local audio tracks', {
      requestedEnabled: enabled,
      reason: context.reason,
      eventType: context.eventType ?? '',
      before,
      after,
    })
    // #endregion
  }, [])

  const executeSceneReadyUnmute = useCallback(() => {
    pendingUnmuteRef.current = false
    sceneGeneratingRef.current = false
    if (sceneGateTimeoutRef.current != null) {
      window.clearTimeout(sceneGateTimeoutRef.current)
      sceneGateTimeoutRef.current = null
    }
    updateSessionTools(REALTIME_TOOLS_ALL)
    setLocalMicEnabled(true, {
      reason: 'scene_ready_unmute',
      hypothesisId: 'H11',
    })
    setIsMicMutedByAssistant(false)
  }, [setLocalMicEnabled, updateSessionTools])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleSceneGenerating = () => {
      sceneGeneratingRef.current = true
      updateSessionTools(REALTIME_TOOLS_WITHOUT_UNMUTE)
      sceneGateTimeoutRef.current = window.setTimeout(() => {
        sceneGateTimeoutRef.current = null
        if (sceneGeneratingRef.current) {
          executeSceneReadyUnmute()
        }
      }, SCENE_GATE_TIMEOUT_MS)
    }

    const handleSceneReady = () => {
      executeSceneReadyUnmute()
    }

    window.addEventListener('storytime:scene-generating', handleSceneGenerating)
    window.addEventListener('storytime:scene-ready', handleSceneReady)
    return () => {
      window.removeEventListener('storytime:scene-generating', handleSceneGenerating)
      window.removeEventListener('storytime:scene-ready', handleSceneReady)
    }
  }, [executeSceneReadyUnmute, updateSessionTools])

  const setCharacterSpeaking = useCallback((isSpeaking: boolean) => {
    if (characterSpeakingRef.current === isSpeaking) return
    characterSpeakingRef.current = isSpeaking
    emitSpeakerState('character', isSpeaking)
    if (isSpeaking) {
      silenceCandidateStartedAtRef.current = null
    }
  }, [emitSpeakerState])

  const cleanup = useCallback(() => {
    void publishRealtimeEvent('voice.session.ended', { reason: 'cleanup' })
    sessionCorrelationIdRef.current = null
    knownEventIdsRef.current.clear()
    if (connectionResetTimerRef.current != null) {
      window.clearTimeout(connectionResetTimerRef.current)
      connectionResetTimerRef.current = null
    }
    if (fallbackResetTimerRef.current != null) {
      window.clearTimeout(fallbackResetTimerRef.current)
      fallbackResetTimerRef.current = null
    }
    if (assistantStopFallbackTimerRef.current != null) {
      window.clearTimeout(assistantStopFallbackTimerRef.current)
      assistantStopFallbackTimerRef.current = null
    }
    cancelAnimationFrame(rafRef.current)
    cancelAnimationFrame(remoteRafRef.current)
    localAudioContextRef.current?.close().catch(() => undefined)
    localAudioContextRef.current = null
    remoteAudioContextRef.current?.close().catch(() => undefined)
    remoteAudioContextRef.current = null
    assistantAudioExpectedRef.current = false
    speechCandidateStartedAtRef.current = null
    silenceCandidateStartedAtRef.current = null
    lastRemoteSpeechAtRef.current = 0
    sceneGeneratingRef.current = false
    pendingUnmuteRef.current = false
    if (sceneGateTimeoutRef.current != null) {
      window.clearTimeout(sceneGateTimeoutRef.current)
      sceneGateTimeoutRef.current = null
    }
    emitSpeakerState('yoko', false)
    setCharacterSpeaking(false)
    setIsMicMutedByAssistant(false)
    dataChannelRef.current?.close()
    dataChannelRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    analyserRef.current = null
    remoteAnalyserRef.current = null

    if (audioRef.current) {
      audioRef.current.srcObject = null
      audioRef.current.onplaying = null
      audioRef.current.onpause = null
      audioRef.current.onended = null
    }
  }, [publishRealtimeEvent, emitSpeakerState, setCharacterSpeaking])

  const monitorAudio = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    cancelAnimationFrame(rafRef.current)
    const tick = () => {
      analyser.getByteFrequencyData(data)
      const sum = data.reduce((a, b) => a + b, 0)
      const avg = sum / data.length / 255
      setAudioLevel(avg)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const monitorRemoteAudio = useCallback(() => {
    const analyser = remoteAnalyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.fftSize)
    cancelAnimationFrame(remoteRafRef.current)
    const tick = () => {
      analyser.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let index = 0; index < data.length; index += 1) {
        const normalized = (data[index] - 128) / 128
        sumSquares += normalized * normalized
      }
      const rms = Math.sqrt(sumSquares / data.length)
      const now = performance.now()

      if (rms >= REMOTE_SPEECH_START_THRESHOLD) {
        lastRemoteSpeechAtRef.current = now
        silenceCandidateStartedAtRef.current = null
        if (speechCandidateStartedAtRef.current == null) {
          speechCandidateStartedAtRef.current = now
        }
        if (
          !characterSpeakingRef.current &&
          now - speechCandidateStartedAtRef.current >= REMOTE_MIN_SPEAK_MS
        ) {
          setCharacterSpeaking(true)
        }
      } else if (rms <= REMOTE_SPEECH_STOP_THRESHOLD) {
        speechCandidateStartedAtRef.current = null
        if (silenceCandidateStartedAtRef.current == null) {
          silenceCandidateStartedAtRef.current = now
        }
        if (
          characterSpeakingRef.current &&
          now - silenceCandidateStartedAtRef.current >= REMOTE_MIN_SILENCE_MS
        ) {
          setCharacterSpeaking(false)
        }
      }

      remoteRafRef.current = requestAnimationFrame(tick)
    }
    remoteRafRef.current = requestAnimationFrame(tick)
  }, [setCharacterSpeaking])

  const sendTextMessageToRealtime = useCallback((text: string) => {
    const dc = dataChannelRef.current
    const trimmed = text.trim()
    if (!dc || dc.readyState !== 'open' || !trimmed) return false
    dc.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: trimmed,
            },
          ],
        },
      }),
    )
    dc.send(
      JSON.stringify({
        type: 'response.create',
        response: {
          modalities: ['audio', 'text'],
        },
      }),
    )
    void publishRealtimeEvent('voice.user.transcript.received', {
      transcript: trimmed,
      eventType: 'conversation.item.input_text',
    })
    return true
  }, [publishRealtimeEvent])

  const flushQueuedTextMessages = useCallback(() => {
    const queuedMessages = queuedTextMessagesRef.current
    if (queuedMessages.length === 0) return
    queuedTextMessagesRef.current = []
    queuedMessages.forEach((message) => {
      sendTextMessageToRealtime(message)
    })
  }, [sendTextMessageToRealtime])

  const connect = useCallback(async () => {
    // #region agent log
    sendDebugLog('H6', 'VoiceChatButton.tsx:connect', 'Connect started', {
      characterId: character.id,
      selectedVoice,
    })
    // #endregion
    setState('connecting')

    try {
      const activeConversationId = await ensureConversationId()
      const fallbackCorrelationId = crypto.randomUUID()
      sessionCorrelationIdRef.current = fallbackCorrelationId

      const tokenRes = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: character.id,
          conversationId: activeConversationId,
          correlationId: fallbackCorrelationId,
        }),
      })

      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({ error: 'Unbekannter Fehler' }))
        throw new Error((body as { error?: string }).error ?? `HTTP ${tokenRes.status}`)
      }

      const sessionData = (await tokenRes.json()) as {
        token: string
        correlationId?: string
        lastSceneImage?: { base64: string; mimeType: string; summary: string }
      }
      const { token, lastSceneImage } = sessionData
      if (typeof sessionData.correlationId === 'string' && sessionData.correlationId.trim()) {
        sessionCorrelationIdRef.current = sessionData.correlationId.trim()
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStreamRef.current = stream

      const audioCtx = new AudioContext()
      localAudioContextRef.current = audioCtx
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const pc = new RTCPeerConnection()
      pcRef.current = pc

      const audio = audioRef.current ?? document.createElement('audio')
      audio.autoplay = true
      audioRef.current = audio

      const remoteStream = new MediaStream()
      audio.srcObject = remoteStream
      audio.onplaying = () => {
        setCharacterSpeaking(true)
      }
      audio.onpause = () => {
        if (!assistantAudioExpectedRef.current) {
          setCharacterSpeaking(false)
        }
      }
      audio.onended = () => {
        setCharacterSpeaking(false)
      }

      let remoteAnalyserInitialized = false

      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => {
          remoteStream.addTrack(track)
        })
        if (!remoteAnalyserInitialized && remoteStream.getAudioTracks().length > 0) {
          remoteAnalyserInitialized = true
          const remoteAudioCtx = new AudioContext()
          remoteAudioContextRef.current = remoteAudioCtx
          const remoteSource = remoteAudioCtx.createMediaStreamSource(remoteStream)
          const remoteAnalyser = remoteAudioCtx.createAnalyser()
          remoteAnalyser.fftSize = 256
          remoteSource.connect(remoteAnalyser)
          remoteAnalyserRef.current = remoteAnalyser
          monitorRemoteAudio()
        }
      }

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream)
      })

      const dc = pc.createDataChannel('oai-events')
      dataChannelRef.current = dc
      dc.onopen = () => {
        if (lastSceneImage?.base64) {
          dc.send(
            JSON.stringify({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: 'user',
                content: [
                  {
                    type: 'input_image',
                    image_url: `data:${lastSceneImage.mimeType};base64,${lastSceneImage.base64}`,
                  },
                ],
              },
            }),
          )
        }
        flushQueuedTextMessages()
      }
      dc.onmessage = (event) => {
        if (typeof event.data !== 'string') return

        try {
          const payload = JSON.parse(event.data) as Record<string, unknown>
          const eventType = typeof payload.type === 'string' ? payload.type : ''
          const eventId = typeof payload.event_id === 'string' ? payload.event_id : ''
          if (eventId && knownEventIdsRef.current.has(eventId)) {
            // #region agent log
            sendDebugLog('H4', 'VoiceChatButton.tsx:onmessage', 'Duplicate realtime event ignored', {
              eventType,
              eventId,
            })
            // #endregion
            return
          }
          if (eventId) {
            knownEventIdsRef.current.add(eventId)
          }

          const assistantSpeechStarted = isAssistantResponseStartEvent(eventType)
          const assistantSpeechStopped = isAssistantResponseStopEvent(eventType)
          const micRelevantEvent =
            assistantSpeechStarted ||
            assistantSpeechStopped ||
            eventType === 'conversation.item.input_audio_transcription.completed' ||
            eventType === 'conversation.item.input_audio_transcription.failed' ||
            eventType === 'input_audio_buffer.speech_started' ||
            eventType === 'input_audio_buffer.speech_stopped' ||
            eventType === 'response.audio_transcript.done' ||
            eventType === 'response.output_audio_transcript.done'

          if (micRelevantEvent) {
            // #region agent log
            sendDebugLog('H1', 'VoiceChatButton.tsx:onmessage', 'Realtime mic-relevant event received', {
              eventType,
              eventId,
              assistantSpeechStarted,
            })
            // #endregion
          }

          if (assistantSpeechStarted) {
            assistantAudioExpectedRef.current = true
            if (assistantStopFallbackTimerRef.current != null) {
              window.clearTimeout(assistantStopFallbackTimerRef.current)
              assistantStopFallbackTimerRef.current = null
            }
            setLocalMicEnabled(false, {
              reason: 'assistant_response_started',
              hypothesisId: 'H2',
              eventType,
            })
            setIsMicMutedByAssistant(true)
            emitSpeakerState('yoko', false)
            setCharacterSpeaking(true)
          }

          if (assistantSpeechStopped) {
            assistantAudioExpectedRef.current = false
            if (assistantStopFallbackTimerRef.current != null) {
              window.clearTimeout(assistantStopFallbackTimerRef.current)
            }
            assistantStopFallbackTimerRef.current = window.setTimeout(() => {
              const now = performance.now()
              if (now - lastRemoteSpeechAtRef.current > ASSISTANT_STOP_FALLBACK_MS) {
                setCharacterSpeaking(false)
              }
            }, ASSISTANT_STOP_FALLBACK_MS)
          }

          if (eventType === 'output_audio_buffer.stopped') {
            setLocalMicEnabled(true, {
              reason: 'playback_finished',
              hypothesisId: 'H10',
              eventType,
            })
            setIsMicMutedByAssistant(false)
          }

          if (eventType === 'input_audio_buffer.speech_started') {
            recoverySentForCurrentTurnRef.current = false
            assistantAudioExpectedRef.current = false
            setCharacterSpeaking(false)
            emitSpeakerState('yoko', true)
          }

          if (eventType === 'input_audio_buffer.speech_stopped') {
            emitSpeakerState('yoko', false)
          }

          if (eventType === 'conversation.item.input_audio_transcription.completed') {
            const transcript = typeof payload.transcript === 'string' ? payload.transcript : ''
            if (transcript) {
              addChatMessage('user', transcript)
              void publishRealtimeEvent('voice.user.transcript.received', {
                transcript,
                eventType,
              })
              void fetch('/api/realtime/instructions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  characterId: character.id,
                  conversationId: activeConversationIdRef.current ?? undefined,
                  correlationId: sessionCorrelationIdRef.current ?? undefined,
                  payload: activeLearningGoalId ? { learningGoalId: activeLearningGoalId } : undefined,
                }),
              })
                .then(async (response) => {
                  if (!response.ok) return
                  const data = (await response.json().catch(() => ({}))) as { instructions?: string }
                  const instructions =
                    typeof data.instructions === 'string' ? data.instructions.trim() : ''
                  if (!instructions) return
                  const activeDc = dataChannelRef.current
                  if (activeDc?.readyState !== 'open') return
                  activeDc.send(
                    JSON.stringify({
                      type: 'session.update',
                      session: { instructions },
                    }),
                  )
                })
                .catch(() => undefined)
            }
            return
          }

          if (eventType === 'conversation.item.input_audio_transcription.failed') {
            const dc = dataChannelRef.current
            if (dc?.readyState === 'open' && !recoverySentForCurrentTurnRef.current) {
              recoverySentForCurrentTurnRef.current = true
              dc.send(
                JSON.stringify({
                  type: 'response.create',
                  response: {
                    modalities: ['audio', 'text'],
                    instructions:
                      'Bitte antworte freundlich auf Deutsch, bitte das Kind, den letzten Satz langsam zu wiederholen, und stelle am Ende genau eine kurze Anschlussfrage.',
                  },
                }),
              )
            }
            return
          }

          if (eventType === 'response.done') {
            const response = payload.response as { output?: unknown[] } | undefined
            const outputLength = Array.isArray(response?.output) ? response.output.length : 0

            if (outputLength === 0) {
              const dc = dataChannelRef.current
              if (dc?.readyState === 'open' && !recoverySentForCurrentTurnRef.current) {
                recoverySentForCurrentTurnRef.current = true
                dc.send(
                  JSON.stringify({
                    type: 'response.create',
                    response: {
                      modalities: ['audio', 'text'],
                      instructions:
                        'Bitte antworte jetzt mit einem kurzen freundlichen Satz auf Deutsch und stelle am Ende genau eine kurze Anschlussfrage.',
                    },
                  }),
                )
              }
            }
            return
          }

          if (eventType === 'response.function_call_arguments.done') {
            const functionName = typeof payload.name === 'string' ? payload.name : ''
            const callId = typeof payload.call_id === 'string' ? payload.call_id : ''
            if (functionName === 'unmute_user_microphone') {
              emitSpeakerState('yoko', false)
              setCharacterSpeaking(false)
              sendFunctionCallOutput(callId, { ok: true })
              if (sceneGeneratingRef.current) {
                pendingUnmuteRef.current = true
                return
              }
              setLocalMicEnabled(true, {
                reason: 'assistant_tool_unmute',
                hypothesisId: 'H9',
                eventType,
              })
              setIsMicMutedByAssistant(false)
            } else if (functionName === 'read_relationships' || functionName === 'read_activities') {
              const rawArguments =
                typeof payload.arguments === 'string' ? payload.arguments : '{}'
              let parsedArguments: Record<string, unknown> = {}
              try {
                const parsed = JSON.parse(rawArguments)
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                  parsedArguments = parsed as Record<string, unknown>
                }
              } catch {
                parsedArguments = {}
              }
              void executeRealtimeToolCall({
                toolName: functionName,
                args: parsedArguments,
              })
                .then((result) => {
                  sendFunctionCallOutput(callId, { ok: true, result })
                })
                .catch((error) => {
                  const message = error instanceof Error ? error.message : String(error)
                  sendFunctionCallOutput(callId, { ok: false, error: message })
                })
            }
            return
          }

          if (
            eventType === 'response.audio_transcript.done' ||
            eventType === 'response.output_audio_transcript.done'
          ) {
            const transcript = typeof payload.transcript === 'string' ? payload.transcript : ''
            const assistantQuestion = isAssistantQuestion(transcript)
            // #region agent log
            sendDebugLog('H3', 'VoiceChatButton.tsx:onmessage', 'Assistant transcript completed', {
              eventType,
              transcript,
              assistantQuestion,
            })
            // #endregion
            if (transcript) {
              void publishRealtimeEvent('voice.assistant.transcript.received', {
                transcript,
                eventType,
              })
              void fetch('/api/realtime/instructions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  characterId: character.id,
                  conversationId: activeConversationIdRef.current ?? undefined,
                  correlationId: sessionCorrelationIdRef.current ?? undefined,
                  payload: activeLearningGoalId ? { learningGoalId: activeLearningGoalId } : undefined,
                }),
              })
                .then(async (response) => {
                  if (!response.ok) return
                  const data = (await response.json().catch(() => ({}))) as { instructions?: string }
                  const instructions =
                    typeof data.instructions === 'string' ? data.instructions.trim() : ''
                  if (!instructions) return
                  const activeDc = dataChannelRef.current
                  if (activeDc?.readyState !== 'open') return
                  activeDc.send(
                    JSON.stringify({
                      type: 'session.update',
                      session: { instructions },
                    }),
                  )
                })
                .catch(() => undefined)
              addChatMessage('assistant', transcript)
            }
          }
        } catch {
          // Ignore malformed realtime events.
        }
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpRes = await fetch(
        'https://api.openai.com/v1/realtime?model=gpt-realtime',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        },
      )

      if (!sdpRes.ok) {
        throw new Error(`WebRTC-Handshake fehlgeschlagen (${sdpRes.status})`)
      }

      const answerSdp = await sdpRes.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      setIsMicMutedByAssistant(false)
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setState('connected')
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          void publishRealtimeEvent('voice.session.failed', {
            reason: pc.connectionState,
          })
          setState('error')
          connectionResetTimerRef.current = window.setTimeout(() => {
            cleanup()
            setState('idle')
          }, 2000)
        }
      }
      setState('connected')
      monitorAudio()
    } catch {
      // #region agent log
      sendDebugLog('H6', 'VoiceChatButton.tsx:connect', 'Connect failed and cleanup triggered', {})
      // #endregion
      void publishRealtimeEvent('voice.session.failed', { reason: 'connect-error' })
      setState('error')
      cleanup()
      fallbackResetTimerRef.current = window.setTimeout(() => setState('idle'), 2000)
    }
  }, [
    character.id,
    cleanup,
    monitorAudio,
    selectedVoice,
    addChatMessage,
    setLocalMicEnabled,
    emitSpeakerState,
    setCharacterSpeaking,
    monitorRemoteAudio,
    flushQueuedTextMessages,
    publishRealtimeEvent,
    executeRealtimeToolCall,
    sendFunctionCallOutput,
    activeLearningGoalId,
    ensureConversationId,
  ])

  useEffect(() => {
    return cleanup
  }, [cleanup])

  useEffect(() => {
    if (state !== 'connecting' && state !== 'connected') return

    let cancelled = false

    const syncInstructions = async () => {
      const dc = dataChannelRef.current
      const correlationId = sessionCorrelationIdRef.current
      if (cancelled || !dc || dc.readyState !== 'open' || !correlationId) return

      const response = await fetch('/api/realtime/instructions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: character.id,
          conversationId: activeConversationIdRef.current ?? undefined,
          correlationId,
          payload: activeLearningGoalId ? { learningGoalId: activeLearningGoalId } : undefined,
        }),
      }).catch(() => null)
      if (cancelled || !response?.ok) return

      const payload = (await response.json().catch(() => ({}))) as { instructions?: string }
      const instructions = typeof payload.instructions === 'string' ? payload.instructions.trim() : ''
      if (!instructions) return

      dc.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            instructions,
          },
        }),
      )
    }

    void syncInstructions()

    return () => {
      cancelled = true
    }
  }, [state, character.id, activeLearningGoalId])

  const handleClick = useCallback(() => {
    if (state === 'connected' && isMicMutedByAssistant) {
      setLocalMicEnabled(true, {
        reason: 'manual_click_unmute',
        hypothesisId: 'H8',
      })
      setIsMicMutedByAssistant(false)
      return
    }
    if (state === 'idle' || state === 'error') {
      // #region agent log
      sendDebugLog('H6', 'VoiceChatButton.tsx:handleClick', 'Voice button clicked for connect', {
        state,
        characterId: character.id,
      })
      // #endregion
      connect()
    }
  }, [state, connect, character.id, isMicMutedByAssistant, setLocalMicEnabled])

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      void publishRealtimeEvent('voice.session.ended', { reason: 'manual-close' })
      cleanup()
      emitSpeakerState('yoko', false)
      setCharacterSpeaking(false)
      setIsMicMutedByAssistant(false)
      setAudioLevel(0)
      setState('idle')
    },
    [cleanup, emitSpeakerState, setCharacterSpeaking, publishRealtimeEvent],
  )

  const isActive = state === 'connecting' || state === 'connected'
  const ringScale = 1 + audioLevel * 0.5
  const sendTextMessage = useCallback((rawText: string) => {
    const text = rawText.trim()
    if (!text) return
    addChatMessage('user', text)
    setTextInputValue('')
    if (sendTextMessageToRealtime(text)) return
    queuedTextMessagesRef.current.push(text)
    if (state === 'idle' || state === 'error') {
      void connect()
    }
  }, [addChatMessage, connect, sendTextMessageToRealtime, state])

  const handleTextSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    sendTextMessage(textInputValue)
  }, [sendTextMessage, textInputValue])

  const textChatComposer = (
    <form
      className={`vcb-text-chat-input-row${resolvedTextChatMountNode ? ' vcb-text-chat-input-row-embedded' : ''}`}
      onSubmit={handleTextSubmit}
    >
      <input
        className="vcb-text-chat-input"
        type="text"
        value={textInputValue}
        onChange={(event) => setTextInputValue(event.target.value)}
        placeholder="Nachricht schreiben..."
      />
      <button
        type="submit"
        className="vcb-text-chat-send"
        aria-label="Nachricht senden"
      >
        <SendOutlined />
      </button>
    </form>
  )

  return (
    <>
      <div className="vcb-wrapper">
        <button
          className={`vcb-button ${isActive ? 'vcb-button-active' : ''} ${state === 'error' ? 'vcb-button-error' : ''}`}
          onClick={handleClick}
          type="button"
        >
          {isActive && (
            <>
              <span
                className="vcb-ring vcb-ring-1"
                style={{ transform: `scale(${ringScale})` }}
              />
              <span
                className="vcb-ring vcb-ring-2"
                style={{ transform: `scale(${1 + audioLevel * 0.8})` }}
              />
            </>
          )}

          <span className="vcb-icon-area">
            {state === 'idle' && (
              <>
                <AudioOutlined className="vcb-mic-icon" />
                <span className="vcb-label">Setze die Geschichte fort</span>
              </>
            )}
            {state === 'connecting' && <LoadingOutlined className="vcb-spinner" />}
            {state === 'connected' &&
              (isMicMutedByAssistant ? (
                <AudioMutedOutlined className="vcb-mic-icon vcb-mic-live" />
              ) : (
                <AudioOutlined className="vcb-mic-icon vcb-mic-live" />
              ))}
            {state === 'error' && <span className="vcb-error-dot" />}
          </span>
        </button>
        {isActive && (
          <button className="vcb-close" onClick={handleClose} type="button" aria-label="Beenden">
            <CloseOutlined />
          </button>
        )}
      </div>
      {enableTextChat && resolvedTextChatMountNode && createPortal(
        <div className="character-activity-chat-composer">
          {textChatComposer}
        </div>,
        resolvedTextChatMountNode,
      )}
      {enableTextChat && !resolvedTextChatMountNode && (
        <div className="vcb-text-chat-root">
          {isTextChatOpen && (
            <div className="vcb-text-chat-panel" role="dialog" aria-label="Textchat">
              <div className="vcb-text-chat-header">
                <span>Mit {character.name} schreiben</span>
                <button
                  type="button"
                  className="vcb-text-chat-close"
                  onClick={() => setIsTextChatOpen(false)}
                  aria-label="Textchat schliessen"
                >
                  <CloseOutlined />
                </button>
              </div>
              <ChatPanel
                messages={chatMessages}
                onSendMessage={sendTextMessage}
                emptyText="Schreibe eine Nachricht, um die Conversation automatisch zu starten."
                className="vcb-text-chat-panel-body"
              />
            </div>
          )}
          <button
            className="vcb-button vcb-button-active vcb-text-chat-launcher"
            onClick={() => setIsTextChatOpen((prev) => !prev)}
            type="button"
            aria-label={isTextChatOpen ? 'Textchat minimieren' : 'Textchat oeffnen'}
          >
            <span className="vcb-icon-area">
              <MessageOutlined className="vcb-mic-icon vcb-mic-live" />
            </span>
          </button>
        </div>
      )}
    </>
  )
}
