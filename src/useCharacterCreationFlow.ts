import { useEffect, useMemo, useRef, useState } from 'react'

export type AssetJob = {
  id: string
  type: string
  status: 'planned' | 'running' | 'generated' | 'skipped' | 'failed'
}

export type CharacterCreationJob = {
  id: string
  updatedAt: string
  phase: 'draft' | 'saving' | 'generating' | 'completed' | 'failed'
  message: string
  characterId?: string
  error?: string
  assets: AssetJob[]
}

export type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
}

type ChatResponse = {
  reply: string
  isReady: boolean
  compiledPrompt: string
}

export type ReferenceImage = {
  id: string
  fileName: string
  mimeType: string
  previewDataUrl: string
  summary: string
}

type PendingReferenceImage = {
  id: string
  file: File
}

const createId = (): string => `${Date.now()}-${Math.random().toString(16).slice(2)}`

export const buildLocalFallbackResponse = (
  nextMessages: Array<{ role: 'assistant' | 'user'; text: string }>,
): ChatResponse => {
  const userMessages = nextMessages
    .filter((message) => message.role === 'user')
    .map((message) => message.text.trim())
    .filter((value) => value.length > 0)
  const compiledPrompt = userMessages.join('\n')
  const isReady = compiledPrompt.length >= 80

  return {
    reply: isReady
      ? 'Danke, ich habe genug Infos. Du kannst jetzt den Character erstellen.'
      : 'Ich brauche noch etwas mehr: Name, Aussehen, Outfit, Persoenlichkeit und Ziel der Figur.',
    isReady,
    compiledPrompt,
  }
}

const fetchJson = async <T,>(input: RequestInfo, init?: RequestInit): Promise<T> => {
  const requestMethod = (init?.method ?? 'GET').toUpperCase()
  const requestUrl = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input)
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  let responsePreview = ''
  try {
    responsePreview = (await response.clone().text()).slice(0, 400)
  } catch {
    responsePreview = '<response-text-unavailable>'
  }
  let data: (T & { error?: string; message?: string }) | null = null
  try {
    data = (await response.json()) as T & { error?: string; message?: string }
  } catch (parseError) {
    throw new Error(
      `API antwortet nicht als JSON (${requestMethod} ${requestUrl}, ${response.status}). ${responsePreview}`,
    )
  }

  if (!response.ok) {
    const errorMessage =
      (typeof data?.error === 'string' && data.error.trim()) ||
      (typeof data?.message === 'string' && data.message.trim()) ||
      `API-Fehler ${response.status} bei ${requestMethod} ${requestUrl}`
    throw new Error(errorMessage)
  }

  return data as T
}

export function useCharacterCreationFlow({
  onCharacterCreated,
}: {
  onCharacterCreated?: () => Promise<void> | void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId(),
      role: 'assistant',
      text: 'Ich bin Merlin. Wir erfinden zusammen deinen Character. Du kannst mir ein Bild zeigen oder ihn beschreiben. Zum Beispiel: ein kleiner mutiger Fuchs mit gruener Jacke.',
    },
  ])
  const [chatLoading, setChatLoading] = useState(false)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [compiledPrompt, setCompiledPrompt] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [job, setJob] = useState<CharacterCreationJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([])
  const [pendingReferenceImages, setPendingReferenceImages] = useState<PendingReferenceImage[]>([])
  const lastJobMessageRef = useRef<string>('')

  useEffect(() => {
    if (!job || job.phase === 'completed' || job.phase === 'failed') return

    const interval = window.setInterval(async () => {
      try {
        const nextJob = await fetchJson<CharacterCreationJob>(`/api/character-creator/jobs/${job.id}`)
        setJob(nextJob)
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : String(pollError))
      }
    }, 1500)

    return () => window.clearInterval(interval)
  }, [job])

  useEffect(() => {
    if (!job) return
    if (job.message && job.message !== lastJobMessageRef.current) {
      lastJobMessageRef.current = job.message
      setMessages((current) => [...current, { id: createId(), role: 'assistant', text: job.message }])
    }

    if (job.phase === 'completed') {
      setGenerateLoading(false)
      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          text: `Fertig! Character ${job.characterId ?? ''} wurde erstellt und Assets sind bereit.`,
        },
      ])
      void onCharacterCreated?.()
    }

    if (job.phase === 'failed') {
      setGenerateLoading(false)
      setError(job.error ?? job.message)
    }
  }, [job, onCharacterCreated])

  const progressPercent = useMemo(() => {
    if (!job || job.assets.length === 0) return 0
    const done = job.assets.filter((asset) => asset.status === 'generated').length
    return Math.round((done / job.assets.length) * 100)
  }, [job])

  const readFileAsDataUrl = async (file: File): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result ?? ''))
      reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'))
      reader.readAsDataURL(file)
    })

  const uploadReferenceImage = async (
    file: File,
  ): Promise<{ reply: string; referenceImage: ReferenceImage }> => {
    const dataUrl = await readFileAsDataUrl(file)
    return fetchJson<{ reply: string; referenceImage: ReferenceImage }>(
      '/api/character-creator/reference-image',
      {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          dataUrl,
        }),
      },
    )
  }

  const queueReferenceImage = (file: File): void => {
    setPendingReferenceImages([{ id: createId(), file }])
    setMessages((current) => [
      ...current,
      {
        id: createId(),
        role: 'assistant',
        text: `Bild "${file.name}" vorgemerkt. Ich nutze es, sobald du auf Character erstellen klickst.`,
      },
    ])
  }

  const sendMessage = async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || chatLoading || uploadLoading || generateLoading) return

    const nextMessages = [...messages, { id: createId(), role: 'user' as const, text: trimmed }]
    setMessages(nextMessages)
    setError(null)
    setChatLoading(true)

    try {
      const response = await fetchJson<ChatResponse>('/api/character-creator/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({ role: message.role, content: message.text })),
        }),
      })
      setCompiledPrompt(response.compiledPrompt)
      setIsReady(response.isReady)
      setMessages((current) => [...current, { id: createId(), role: 'assistant', text: response.reply }])
    } catch (chatError) {
      const fallback = buildLocalFallbackResponse(nextMessages)
      setCompiledPrompt(fallback.compiledPrompt)
      setIsReady(fallback.isReady)
      setMessages((current) => [...current, { id: createId(), role: 'assistant', text: fallback.reply }])
      setError(
        chatError instanceof Error
          ? `Chat-API nicht erreichbar, lokaler Fallback aktiv: ${chatError.message}`
          : 'Chat-API nicht erreichbar, lokaler Fallback aktiv.',
      )
    } finally {
      setChatLoading(false)
    }
  }

  const startCharacterCreation = async (skipAndCreate = false): Promise<void> => {
    if (generateLoading || job) return
    if (
      !skipAndCreate &&
      !compiledPrompt &&
      referenceImages.length === 0 &&
      pendingReferenceImages.length === 0
    ) {
      return
    }

    setGenerateLoading(true)
    setError(null)

    try {
      let nextReferenceImages = [...referenceImages]
      let nextCompiledPrompt = compiledPrompt
      let nextReady = isReady

      if (pendingReferenceImages.length > 0) {
        setUploadLoading(true)
        setMessages((current) => [
          ...current,
          {
            id: createId(),
            role: 'assistant',
            text: 'Ich analysiere jetzt deine Bildvorlagen und nehme sie direkt in die Character-Erstellung mit.',
          },
        ])

        const uploaded = await Promise.all(
          pendingReferenceImages.map(async ({ file }) => uploadReferenceImage(file)),
        )
        const uploadedReferences = uploaded.map((entry) => entry.referenceImage)

        nextReferenceImages = [...nextReferenceImages, ...uploadedReferences]
        nextCompiledPrompt = [
          nextCompiledPrompt,
          ...uploadedReferences.map((image) => `Visuelle Referenz: ${image.summary}`),
        ]
          .filter(Boolean)
          .join('\n')
        nextReady = nextReady || uploadedReferences.some((image) => image.summary.trim().length >= 120)

        setReferenceImages(nextReferenceImages)
        setCompiledPrompt(nextCompiledPrompt)
        setIsReady(nextReady)
        setPendingReferenceImages([])
        setMessages((current) => [
          ...current,
          ...uploaded.map((entry) => ({
            id: createId(),
            role: 'assistant' as const,
            text: `Ich habe dein Bild als Vorlage gespeichert: ${entry.referenceImage.summary}`,
          })),
          ...uploaded.map((entry) => ({
            id: createId(),
            role: 'assistant' as const,
            text: entry.reply,
          })),
        ])
      }

      setMessages((current) => [
        ...current,
        {
          id: createId(),
          role: 'assistant',
          text: skipAndCreate
            ? 'Alles klar. Ich fuelle den Rest kreativ aus und erstelle jetzt deinen Character.'
            : 'Super, ich erstelle jetzt deinen Character und starte die Bilder.',
        },
      ])

      const startResponse = await fetchJson<{ jobId: string }>('/api/character-creator/start', {
        method: 'POST',
        body: JSON.stringify({
          prompt: nextCompiledPrompt,
          fillMissingFieldsCreatively:
            skipAndCreate || (!nextReady && nextReferenceImages.length === 0),
          referenceImageIds: nextReferenceImages.map((image) => image.id),
        }),
      })
      const nextJob = await fetchJson<CharacterCreationJob>(
        `/api/character-creator/jobs/${startResponse.jobId}`,
      )
      lastJobMessageRef.current = ''
      setJob(nextJob)
    } catch (startError) {
      setGenerateLoading(false)
      setError(startError instanceof Error ? startError.message : String(startError))
    } finally {
      setUploadLoading(false)
    }
  }

  return {
    messages,
    chatLoading,
    uploadLoading,
    generateLoading,
    compiledPrompt,
    isReady,
    job,
    error,
    referenceImages,
    pendingReferenceImages,
    progressPercent,
    queueReferenceImage,
    sendMessage,
    startCharacterCreation,
    clearError: () => setError(null),
  }
}
