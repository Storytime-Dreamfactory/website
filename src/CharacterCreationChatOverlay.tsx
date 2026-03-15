import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PictureOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { Button, Input, Modal, Popover, Progress, Space, Tag, Typography } from 'antd'

const { Text } = Typography

type AssetJob = {
  id: string
  type: string
  status: 'planned' | 'running' | 'generated' | 'skipped' | 'failed'
}

type CharacterCreationJob = {
  id: string
  updatedAt: string
  phase: 'draft' | 'saving' | 'generating' | 'completed' | 'failed'
  message: string
  characterId?: string
  error?: string
  assets: AssetJob[]
}

type ChatMessage = {
  id: string
  role: 'assistant' | 'user'
  text: string
}

type ChatResponse = {
  reply: string
  isReady: boolean
  compiledPrompt: string
}

type ReferenceImage = {
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

const buildLocalFallbackResponse = (
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
  } catch {
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

export default function CharacterCreationChatOverlay({
  onCharacterCreated,
}: {
  onCharacterCreated: () => Promise<void> | void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [open, setOpen] = useState(false)
  const [inputText, setInputText] = useState('')
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
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, open])

  useEffect(() => {
    if (!job || job.phase === 'completed' || job.phase === 'failed') {
      return
    }

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
      void onCharacterCreated()
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

  const sendMessage = async (): Promise<void> => {
    const text = inputText.trim()
    if (!text || chatLoading || uploadLoading || generateLoading) {
      return
    }

    const nextMessages = [...messages, { id: createId(), role: 'user' as const, text }]
    setMessages(nextMessages)
    setInputText('')
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

  const handleUploadClick = (): void => {
    if (uploadLoading || generateLoading || job) {
      return
    }
    fileInputRef.current?.click()
  }

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
        nextReady =
          nextReady || uploadedReferences.some((image) => image.summary.trim().length >= 120)

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
          fillMissingFieldsCreatively: skipAndCreate || !nextReady,
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

  return (
    <>
      <button className="vcb-button" type="button" onClick={() => setOpen(true)}>
        <span className="vcb-icon-area">
          <AudioOutlined className="vcb-mic-icon" />
          <span className="vcb-label">Mit Merlin Character erstellen</span>
        </span>
      </button>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={760}
        style={{
          background:
            'radial-gradient(circle at top right, rgba(113, 176, 255, 0.22), rgba(113, 176, 255, 0) 42%), linear-gradient(160deg, rgba(8, 14, 34, 0.96), rgba(3, 8, 24, 0.94))',
          border: '1px solid rgba(156, 211, 255, 0.28)',
          boxShadow: '0 28px 72px rgba(0, 0, 0, 0.66), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
          backdropFilter: 'blur(12px)',
          borderRadius: 20,
          overflow: 'hidden',
        }}
        styles={{
          header: {
            background: 'transparent',
            borderBottom: '1px solid rgba(156, 211, 255, 0.2)',
            paddingBottom: 14,
            flex: '0 0 auto',
          },
          body: {
            paddingTop: 14,
            paddingBottom: 14,
            flex: '1 1 auto',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          },
        }}
        title={
          <div className="character-chat-heading">
            <div className="character-chat-heading-howto">
              <span>Merlin fuehrt dich Schritt fuer Schritt durch deinen Character.</span>
              <span>Du kannst ein Bild hochladen oder Merlin sagen, wie dein Character aussieht.</span>
            </div>
            <div className="character-chat-heading-main">
              <span className="character-chat-heading-title">Merlin hilft dir beim Character-Bauen</span>
              <Popover
                trigger="hover"
                placement="bottomRight"
                content="Merlin fragt nach Aussehen, Gefuehlen und Eigenschaften. Du kannst jederzeit auf Skip and create druecken, dann wird der Rest kreativ ausgefuellt."
              >
                <Button
                  className="character-chat-info-btn"
                  type="text"
                  size="small"
                  icon={<InfoCircleOutlined />}
                  aria-label="Mehr Infos"
                />
              </Popover>
            </div>
            <span className="character-chat-heading-subline">Text-Chat im Merlin-Stil mit optionalem Bild-Upload</span>
          </div>
        }
        rootClassName="character-chat-modal-root"
        className="character-chat-modal"
      >
        <div className="character-chat-layout">
          <div className="character-chat-log">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`character-chat-message ${
                  message.role === 'assistant' ? 'character-chat-message-assistant' : 'character-chat-message-user'
                }`}
              >
                {message.text}
              </div>
            ))}
            <div ref={bottomAnchorRef} />
          </div>

          <div className="character-chat-footer">
            {error && (
              <Text type="danger" className="character-chat-error">
                {error}
              </Text>
            )}

            {(referenceImages.length > 0 || pendingReferenceImages.length > 0) && (
              <div className="character-chat-progress">
                <Space wrap>
                  {pendingReferenceImages.map((image) => (
                    <Tag key={image.id} color="gold">
                      Ausgewaehlt: {image.file.name}
                    </Tag>
                  ))}
                  {referenceImages.map((image) => (
                    <Tag key={image.id} color="blue">
                      Bildvorlage: {image.fileName}
                    </Tag>
                  ))}
                </Space>
              </div>
            )}

            {job && (
              <div className="character-chat-progress">
                <Space>
                  <Tag color={job.phase === 'completed' ? 'success' : job.phase === 'failed' ? 'error' : 'processing'}>
                    {job.phase}
                  </Tag>
                  <Text>{job.message}</Text>
                </Space>
                <Progress
                  percent={progressPercent}
                  size="small"
                  status={job.phase === 'failed' ? 'exception' : undefined}
                />
              </div>
            )}

            <div className="character-chat-input-row">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    setPendingReferenceImages((current) => [...current, { id: createId(), file }])
                    setMessages((current) => [
                      ...current,
                      {
                        id: createId(),
                        role: 'assistant',
                        text: `Bild "${file.name}" vorgemerkt. Ich nutze es, sobald du auf Character erstellen klickst.`,
                      },
                    ])
                  }
                  event.currentTarget.value = ''
                }}
              />
              <Button
                className="character-chat-upload-btn"
                icon={uploadLoading ? <LoadingOutlined /> : <PictureOutlined />}
                onClick={handleUploadClick}
              >
                Bild hochladen
              </Button>
              <Input
                className="character-chat-input"
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder="Schreib Merlin etwas. Zum Beispiel: Er ist mutig, aber hat Angst vor Gewitter."
                onPressEnter={(event) => {
                  event.preventDefault()
                  void sendMessage()
                }}
              />
              <Button
                className="character-chat-send-btn"
                icon={chatLoading ? <LoadingOutlined /> : <SendOutlined />}
                onClick={() => void sendMessage()}
              />
            </div>

            <div className="character-chat-actions">
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <Text type="secondary">
                  Du kannst auch direkt auf Skip and create druecken. Dann fuellt Storytime die fehlenden Ideen fuer dich aus.
                </Text>
                <Space wrap>
                  <Button
                    className="character-chat-secondary-btn"
                    disabled={!!job}
                    loading={generateLoading && !isReady}
                    onClick={() => void startCharacterCreation(true)}
                  >
                    Skip and create
                  </Button>
                  <Button
                    className="character-chat-create-btn"
                    type="primary"
                    disabled={(!isReady && referenceImages.length === 0 && pendingReferenceImages.length === 0) || !!job}
                    loading={generateLoading}
                    onClick={() => void startCharacterCreation(false)}
                  >
                    Character jetzt erstellen
                  </Button>
                </Space>
              </Space>
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}
