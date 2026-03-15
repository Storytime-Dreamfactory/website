import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiActivityRecord, ApiConversationMessageRecord } from './characterTypes'

export type ConversationStreamState = {
  connected: boolean
  notepadText: string
  notepadUpdatedAt: string | null
  liveMessages: ApiConversationMessageRecord[]
  liveActivities: ApiActivityRecord[]
}

const EMPTY_STATE: ConversationStreamState = {
  connected: false,
  notepadText: '',
  notepadUpdatedAt: null,
  liveMessages: [],
  liveActivities: [],
}

export default function useConversationStream(conversationId: string | null | undefined) {
  const [state, setState] = useState<ConversationStreamState>(EMPTY_STATE)
  const eventSourceRef = useRef<EventSource | null>(null)

  const resetStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setState(EMPTY_STATE)
  }, [])

  useEffect(() => {
    if (!conversationId) {
      resetStream()
      return
    }
    if (typeof window === 'undefined' || typeof window.EventSource !== 'function') return

    const streamUrl = `/api/conversations/stream?conversationId=${encodeURIComponent(conversationId)}`
    const eventSource = new window.EventSource(streamUrl)
    eventSourceRef.current = eventSource

    const handleReady = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          notepad?: string
          notepadUpdatedAt?: string | null
        }
        setState((prev) => ({
          ...prev,
          connected: true,
          notepadText: payload.notepad ?? '',
          notepadUpdatedAt: payload.notepadUpdatedAt ?? null,
        }))
      } catch {
        setState((prev) => ({ ...prev, connected: true }))
      }
    }

    const handleNotepadUpdated = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as {
          text?: string
          updatedAt?: string | null
        }
        setState((prev) => ({
          ...prev,
          notepadText: payload.text ?? prev.notepadText,
          notepadUpdatedAt: payload.updatedAt ?? prev.notepadUpdatedAt,
        }))
      } catch {
        /* ignore invalid payload */
      }
    }

    const handleMessageCreated = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as ApiConversationMessageRecord
        setState((prev) => {
          if (prev.liveMessages.some((m) => m.messageId === message.messageId)) return prev
          return { ...prev, liveMessages: [...prev.liveMessages, message] }
        })
      } catch {
        /* ignore */
      }
    }

    const handleActivityCreated = (event: MessageEvent<string>) => {
      try {
        const activity = JSON.parse(event.data) as ApiActivityRecord
        setState((prev) => {
          if (prev.liveActivities.some((a) => a.activityId === activity.activityId)) return prev
          return { ...prev, liveActivities: [...prev.liveActivities, activity] }
        })
      } catch {
        /* ignore */
      }
    }

    const handleError = () => {
      setState((prev) => ({ ...prev, connected: false }))
    }

    eventSource.addEventListener('ready', handleReady as EventListener)
    eventSource.addEventListener('notepad.updated', handleNotepadUpdated as EventListener)
    eventSource.addEventListener('message.created', handleMessageCreated as EventListener)
    eventSource.addEventListener('activity.created', handleActivityCreated as EventListener)
    eventSource.addEventListener('error', handleError as EventListener)

    return () => {
      eventSource.removeEventListener('ready', handleReady as EventListener)
      eventSource.removeEventListener('notepad.updated', handleNotepadUpdated as EventListener)
      eventSource.removeEventListener('message.created', handleMessageCreated as EventListener)
      eventSource.removeEventListener('activity.created', handleActivityCreated as EventListener)
      eventSource.removeEventListener('error', handleError as EventListener)
      eventSource.close()
      eventSourceRef.current = null
      setState(EMPTY_STATE)
    }
  }, [conversationId, resetStream])

  return state
}
