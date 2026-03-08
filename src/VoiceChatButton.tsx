import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AudioOutlined, CloseOutlined, LoadingOutlined } from '@ant-design/icons'
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

export default function VoiceChatButton({ character }: Props) {
  const [state, setState] = useState<ConnectionState>('idle')
  const [audioLevel, setAudioLevel] = useState(0)
  const selectedVoice = useMemo(() => resolveVoiceForCharacter(character), [character])

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const dataChannelRef = useRef<RTCDataChannel | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number>(0)
  const conversationIdRef = useRef<string | null>(null)
  const knownEventIdsRef = useRef<Set<string>>(new Set())

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

  const connect = useCallback(async () => {
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
            return
          }
          if (eventId) {
            knownEventIdsRef.current.add(eventId)
          }

          if (eventType === 'conversation.item.input_audio_transcription.completed') {
            const transcript = typeof payload.transcript === 'string' ? payload.transcript : ''
            if (transcript) {
              void appendMessage('user', transcript, eventType)
            }
            return
          }

          if (eventType === 'response.audio_transcript.done') {
            const transcript = typeof payload.transcript === 'string' ? payload.transcript : ''
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
      closeConversationSession('error')
      setState('error')
      cleanup()
      setTimeout(() => setState('idle'), 2000)
    }
  }, [character.id, cleanup, monitorAudio, selectedVoice, appendMessage, closeConversationSession, startConversationSession])

  useEffect(() => {
    return cleanup
  }, [cleanup])

  const handleClick = useCallback(() => {
    if (state === 'idle' || state === 'error') {
      connect()
    }
  }, [state, connect])

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      closeConversationSession('manual-close')
      cleanup()
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
          {state === 'connected' && <AudioOutlined className="vcb-mic-icon vcb-mic-live" />}
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
