import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioMutedOutlined, AudioOutlined, CloseOutlined, LoadingOutlined } from '@ant-design/icons'
import type { Character } from './content/types'

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error'

type Props = {
  character: Character
}

const CHARACTER_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] as const

const VOICE_BY_GENDER_EXPRESSION: Record<string, (typeof CHARACTER_VOICES)[number]> = {
  maskulin: 'ash',
  feminin: 'coral',
  maennlich: 'ash',
  weiblich: 'coral',
}

const hashCharacterId = (value: string): number => {
  let hash = 0
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return hash
}

const resolveVoiceForCharacter = (character: Character): (typeof CHARACTER_VOICES)[number] => {
  const genderExpression = character.basis.genderExpression?.trim().toLowerCase()
  if (genderExpression && VOICE_BY_GENDER_EXPRESSION[genderExpression]) {
    return VOICE_BY_GENDER_EXPRESSION[genderExpression]
  }

  // Stabiler Fallback, damit ein Character immer dieselbe Stimme behaelt.
  const index = hashCharacterId(character.id) % CHARACTER_VOICES.length
  return CHARACTER_VOICES[index]
}

const isAssistantResponseStartEvent = (eventType: string): boolean => {
  return (
    eventType === 'output_audio_buffer.started' ||
    eventType === 'response.audio.delta' ||
    eventType === 'response.output_audio.delta'
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

export default function VoiceChatButton({ character }: Props) {
  const [state, setState] = useState<ConnectionState>('idle')
  const [audioLevel, setAudioLevel] = useState(0)
  const [isMicMutedByAssistant, setIsMicMutedByAssistant] = useState(false)
  const selectedVoice = useMemo(() => resolveVoiceForCharacter(character), [character])

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)
  const conversationIdRef = useRef<string | null>(null)
  const knownEventIdsRef = useRef<Set<string>>(new Set())
  const recoverySentForCurrentTurnRef = useRef(false)

  const startConversationSession = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch('/api/conversations/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: character.id,
          metadata: { channel: 'realtime-voice', voice: selectedVoice },
        }),
      })
      if (!response.ok) return null
      const payload = (await response.json()) as { conversation?: { conversationId?: string } }
      return payload.conversation?.conversationId ?? null
    } catch {
      return null
    }
  }, [character.id, selectedVoice])

  const appendMessage = useCallback(
    async (role: 'user' | 'assistant' | 'system', content: string, eventType: string) => {
      const conversationId = conversationIdRef.current
      const trimmed = content.trim()
      if (!conversationId || !trimmed) return

      await fetch('/api/conversations/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          role,
          content: trimmed,
          eventType,
        }),
      }).catch(() => undefined)
    },
    [],
  )

  const closeConversationSession = useCallback((reason: string) => {
    const conversationId = conversationIdRef.current
    conversationIdRef.current = null
    knownEventIdsRef.current.clear()
    if (!conversationId) return

    void fetch('/api/conversations/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        metadata: { endReason: reason },
      }),
    }).catch(() => undefined)
  }, [])

  const cleanup = useCallback(() => {
    closeConversationSession('cleanup')
    cancelAnimationFrame(rafRef.current)
    setIsMicMutedByAssistant(false)
    dataChannelRef.current?.close()
    dataChannelRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    analyserRef.current = null

    if (audioRef.current) {
      audioRef.current.srcObject = null
    }
  }, [closeConversationSession])

  const monitorAudio = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteFrequencyData(data)
      const sum = data.reduce((a, b) => a + b, 0)
      const avg = sum / data.length / 255
      setAudioLevel(avg)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
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

  const sendRealtimeToolOutput = useCallback((callId: string, output: Record<string, unknown>) => {
    const dc = dataChannelRef.current
    if (!dc || dc.readyState !== 'open') return
    const encodedOutput = JSON.stringify(output)
    dc.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: encodedOutput,
        },
      }),
    )
    dc.send(JSON.stringify({ type: 'response.create' }))
  }, [])

  const connect = useCallback(async () => {
    // #region agent log
    sendDebugLog('H6', 'VoiceChatButton.tsx:connect', 'Connect started', {
      characterId: character.id,
      selectedVoice,
    })
    // #endregion
    setState('connecting')

    try {
      const tokenRes = await fetch('/api/realtime/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: character.id, voice: selectedVoice }),
      })

      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => ({ error: 'Unbekannter Fehler' }))
        throw new Error((body as { error?: string }).error ?? `HTTP ${tokenRes.status}`)
      }

      const { token } = (await tokenRes.json()) as { token: string }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      localStreamRef.current = stream

      const audioCtx = new AudioContext()
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

      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => {
          remoteStream.addTrack(track)
        })
      }

      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream)
      })

      const dc = pc.createDataChannel('oai-events')
      dataChannelRef.current = dc
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
          const micRelevantEvent =
            assistantSpeechStarted ||
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
            setLocalMicEnabled(false, {
              reason: 'assistant_response_started',
              hypothesisId: 'H2',
              eventType,
            })
            setIsMicMutedByAssistant(true)
          }

          if (eventType === 'input_audio_buffer.speech_started') {
            recoverySentForCurrentTurnRef.current = false
          }

          if (eventType === 'conversation.item.input_audio_transcription.completed') {
            const transcript = typeof payload.transcript === 'string' ? payload.transcript : ''
            if (transcript) {
              void appendMessage('user', transcript, eventType)
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
                      'Bitte antworte freundlich auf Deutsch und bitte das Kind, den letzten Satz langsam zu wiederholen.',
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
                        'Bitte antworte jetzt mit einem kurzen freundlichen Satz auf Deutsch.',
                    },
                  }),
                )
              }
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
              void appendMessage('assistant', transcript, eventType)
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
      conversationIdRef.current = await startConversationSession()
      setIsMicMutedByAssistant(false)

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setState('connected')
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          closeConversationSession(pc.connectionState)
          setState('error')
          setTimeout(() => {
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
      closeConversationSession('error')
      setState('error')
      cleanup()
      setTimeout(() => setState('idle'), 2000)
    }
  }, [
    character.id,
    cleanup,
    monitorAudio,
    selectedVoice,
    appendMessage,
    closeConversationSession,
    startConversationSession,
    setLocalMicEnabled,
    sendRealtimeToolOutput,
  ])

  useEffect(() => {
    return cleanup
  }, [cleanup])

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
      closeConversationSession('manual-close')
      cleanup()
      setIsMicMutedByAssistant(false)
      setAudioLevel(0)
      setState('idle')
    },
    [cleanup, closeConversationSession],
  )

  const isActive = state === 'connecting' || state === 'connected'
  const ringScale = 1 + audioLevel * 0.5

  return (
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
              <span className="vcb-label">Sprich mit {character.name}</span>
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
  )
}
