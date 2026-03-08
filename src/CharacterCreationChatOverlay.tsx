import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioOutlined, InfoCircleOutlined, LoadingOutlined, SendOutlined } from '@ant-design/icons'
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
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) {
    throw new Error(data.error ?? 'Unbekannter API-Fehler')
  }

  return data
}

export default function CharacterCreationChatOverlay({
  onCharacterCreated,
}: {
  onCharacterCreated: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [inputText, setInputText] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: createId(),
      role: 'assistant',
      text: 'Hi! Ich bin dein Character-Agent. Beschreibe mir deine Figur, dann erstelle ich sie fuer dich.',
    },
  ])
  const [chatLoading, setChatLoading] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [compiledPrompt, setCompiledPrompt] = useState('')
  const [isReady, setIsReady] = useState(false)
  const [job, setJob] = useState<CharacterCreationJob | null>(null)
  const [error, setError] = useState<string | null>(null)
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
    if (!text || chatLoading || generateLoading) {
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

  const startCharacterCreation = async (): Promise<void> => {
    if (!compiledPrompt || generateLoading) return

    setGenerateLoading(true)
    setError(null)

    try {
      setMessages((current) => [
        ...current,
        { id: createId(), role: 'assistant', text: 'Super, ich erstelle jetzt YAML und starte die Assets.' },
      ])

      const draft = await fetchJson<{ yamlText: string }>('/api/character-creator/draft', {
        method: 'POST',
        body: JSON.stringify({ prompt: compiledPrompt }),
      })
      const startResponse = await fetchJson<{ jobId: string }>('/api/character-creator/start', {
        method: 'POST',
        body: JSON.stringify({ yamlText: draft.yamlText, prompt: compiledPrompt }),
      })
      const nextJob = await fetchJson<CharacterCreationJob>(
        `/api/character-creator/jobs/${startResponse.jobId}`,
      )
      lastJobMessageRef.current = ''
      setJob(nextJob)
    } catch (startError) {
      setGenerateLoading(false)
      setError(startError instanceof Error ? startError.message : String(startError))
    }
  }

  return (
    <>
      <button className="vcb-button" type="button" onClick={() => setOpen(true)}>
        <span className="vcb-icon-area">
          <AudioOutlined className="vcb-mic-icon" />
          <span className="vcb-label">Character per Chat erstellen</span>
        </span>
      </button>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={760}
        title={
          <div className="character-chat-heading">
            <div className="character-chat-heading-howto">
              <span>Beschreibe deine eigene Figur in wenigen Saetzen.</span>
              <span>Der Agent sammelt Details und erstellt daraus Character und Assets.</span>
            </div>
            <div className="character-chat-heading-main">
              <span className="character-chat-heading-title">Erfinde deine eigenen Geschichten</span>
              <Popover
                trigger="hover"
                placement="bottomRight"
                content="Tippe zuerst die Idee ein. Wenn genug Infos da sind, wird der Create-Button aktiv und startet die komplette Character-Erstellung."
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
            <span className="character-chat-heading-subline">Erstelle deinen eigenen Character per Chat</span>
          </div>
        }
        rootClassName="character-chat-modal-root"
        className="character-chat-modal"
      >
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

        {error && (
          <Text type="danger" className="character-chat-error">
            {error}
          </Text>
        )}

        {job && (
          <div className="character-chat-progress">
            <Space>
              <Tag color={job.phase === 'completed' ? 'success' : job.phase === 'failed' ? 'error' : 'processing'}>
                {job.phase}
              </Tag>
              <Text>{job.message}</Text>
            </Space>
            <Progress percent={progressPercent} size="small" status={job.phase === 'failed' ? 'exception' : undefined} />
          </div>
        )}

        <div className="character-chat-input-row">
          <Input
            className="character-chat-input"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder="Beschreibe deinen Character..."
            onPressEnter={(event) => {
              event.preventDefault()
              void sendMessage()
            }}
          />
          <Button
            icon={chatLoading ? <LoadingOutlined /> : <SendOutlined />}
            onClick={() => void sendMessage()}
          />
        </div>

        <div className="character-chat-actions">
          <Button
            className="character-chat-create-btn"
            type="primary"
            disabled={!isReady || !compiledPrompt || !!job}
            loading={generateLoading}
            onClick={() => void startCharacterCreation()}
          >
            Character jetzt erstellen
          </Button>
        </div>
      </Modal>
    </>
  )
}
