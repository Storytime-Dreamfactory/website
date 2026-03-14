import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AudioOutlined,
  InboxOutlined,
  LoadingOutlined,
  PictureOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { Alert, Button, Card, Input, Progress, Space, Tag, Typography } from 'antd'
import { Link } from 'react-router-dom'
import type { StoryContent } from './content/types'
import { useCharacterCreationFlow } from './useCharacterCreationFlow'
import './CreateCharacterPage.css'

const { Text, Title, Paragraph } = Typography

type Props = {
  content: StoryContent
  onCharacterCreated: () => Promise<void> | void
}

export default function CreateCharacterPage({ content, onCharacterCreated }: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null)
  const selectedInputPreviewRef = useRef<string | null>(null)
  const [inputText, setInputText] = useState('')
  const [isDragActive, setIsDragActive] = useState(false)
  const [selectedInputImageUrl, setSelectedInputImageUrl] = useState<string | null>(null)
  const [selectedInputFileName, setSelectedInputFileName] = useState<string | null>(null)
  const [loadedFinalProfileImageUrl, setLoadedFinalProfileImageUrl] = useState<string | null>(null)
  const flow = useCharacterCreationFlow({ onCharacterCreated })

  useEffect(() => {
    bottomAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [flow.messages])

  useEffect(
    () => () => {
      if (selectedInputPreviewRef.current) {
        URL.revokeObjectURL(selectedInputPreviewRef.current)
      }
    },
    [],
  )

  const canCreate =
    (flow.isReady || flow.referenceImages.length > 0 || flow.pendingReferenceImages.length > 0) && !flow.job

  const profileAssetReady = Boolean(
    flow.job?.assets?.some((asset) => asset.type === 'profilbild' && asset.status === 'generated'),
  )
  const finalProfileImageUrl = useMemo(() => {
    if (!flow.job?.characterId || !profileAssetReady) return null
    return `/content/characters/${flow.job.characterId}/profilbild.png?v=${encodeURIComponent(
      flow.job.updatedAt,
    )}`
  }, [flow.job?.characterId, flow.job?.updatedAt, profileAssetReady])

  const showFinalProfileImage = Boolean(
    finalProfileImageUrl && loadedFinalProfileImageUrl === finalProfileImageUrl,
  )
  const isTransforming = Boolean(
    !showFinalProfileImage &&
      (flow.generateLoading ||
        flow.job?.phase === 'draft' ||
        flow.job?.phase === 'saving' ||
        flow.job?.phase === 'generating'),
  )

  const isCircleDisabled = flow.uploadLoading || flow.generateLoading || Boolean(flow.job)

  const queueFileForCreation = (file: File): void => {
    if (!file.type.startsWith('image/')) return

    const objectUrl = URL.createObjectURL(file)
    if (selectedInputPreviewRef.current) {
      URL.revokeObjectURL(selectedInputPreviewRef.current)
    }
    selectedInputPreviewRef.current = objectUrl
    setSelectedInputImageUrl(objectUrl)
    setSelectedInputFileName(file.name)
    flow.queueReferenceImage(file)
  }

  return (
    <div className="create-character-page">
      <div className="create-character-layout">
        <section className="create-character-chat-panel">
          <div className="create-character-chat-header">
            <div className="create-character-chat-title-row">
              <span className="create-character-merlin-icon">
                <AudioOutlined />
              </span>
              <Title level={2}>Merlin baut mit dir deinen Character</Title>
            </div>
            <Text>
              Kein Overlay mehr: Hier ist dein kompletter Character-Flow auf einer eigenen Seite.
            </Text>
          </div>

          <div className="create-character-chat-log">
            {flow.messages.map((message) => (
              <div
                key={message.id}
                className={`create-character-message ${
                  message.role === 'assistant'
                    ? 'create-character-message-assistant'
                    : 'create-character-message-user'
                }`}
              >
                {message.text}
              </div>
            ))}
            <div ref={bottomAnchorRef} />
          </div>

          {flow.error && (
            <Alert
              type="error"
              showIcon
              className="create-character-error"
              message="Fehler im Character-Flow"
              description={flow.error}
            />
          )}

          <div className="create-character-controls">
            <div className="create-character-input-row">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                style={{ display: 'none' }}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) queueFileForCreation(file)
                  event.currentTarget.value = ''
                }}
              />
              <Button
                icon={flow.uploadLoading ? <LoadingOutlined /> : <PictureOutlined />}
                onClick={() => fileInputRef.current?.click()}
                disabled={flow.generateLoading || Boolean(flow.job)}
                className="create-character-upload-btn"
              >
                {selectedInputFileName ? 'Bild ersetzen' : 'Bild hochladen'}
              </Button>
              <Input
                value={inputText}
                onChange={(event) => setInputText(event.target.value)}
                placeholder="Beschreibe deinen Character..."
                onPressEnter={(event) => {
                  event.preventDefault()
                  if (!inputText.trim()) return
                  void flow.sendMessage(inputText)
                  setInputText('')
                }}
                className="create-character-input"
              />
              <Button
                icon={flow.chatLoading ? <LoadingOutlined /> : <SendOutlined />}
                onClick={() => {
                  if (!inputText.trim()) return
                  void flow.sendMessage(inputText)
                  setInputText('')
                }}
                disabled={flow.uploadLoading || flow.generateLoading}
                className="create-character-send-btn"
              />
            </div>

            <div className="create-character-actions">
              <Button
                onClick={() => void flow.startCharacterCreation(true)}
                loading={flow.generateLoading && !flow.isReady}
                disabled={Boolean(flow.job)}
              >
                Skip and create
              </Button>
              <Button
                type="primary"
                onClick={() => void flow.startCharacterCreation(false)}
                loading={flow.generateLoading}
                disabled={!canCreate}
              >
                Character jetzt erstellen
              </Button>
            </div>
          </div>
        </section>

        <aside className="create-character-side-panel">
          <Card className="create-character-card" title="Status">
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <div className="create-character-status-circle-shell">
                <div
                  className={`create-character-status-circle ${
                    isDragActive ? 'is-drag-active' : ''
                  } ${isCircleDisabled ? 'is-disabled' : ''}`}
                  role="button"
                  tabIndex={isCircleDisabled ? -1 : 0}
                  aria-disabled={isCircleDisabled}
                  aria-label={
                    selectedInputFileName
                      ? `Bildvorlage ${selectedInputFileName}. Enter druecken, um Bild zu ersetzen.`
                      : 'Bildvorlage per Klick, Drag und Drop oder Upload auswaehlen.'
                  }
                  onClick={() => {
                    if (!isCircleDisabled) fileInputRef.current?.click()
                  }}
                  onKeyDown={(event) => {
                    if (isCircleDisabled) return
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      fileInputRef.current?.click()
                    }
                  }}
                  onDragOver={(event) => {
                    if (isCircleDisabled) return
                    event.preventDefault()
                    setIsDragActive(true)
                  }}
                  onDragLeave={() => setIsDragActive(false)}
                  onDrop={(event) => {
                    if (isCircleDisabled) return
                    event.preventDefault()
                    setIsDragActive(false)
                    const file = event.dataTransfer.files?.[0]
                    if (file) queueFileForCreation(file)
                  }}
                >
                  {selectedInputImageUrl ? (
                    <img
                      src={selectedInputImageUrl}
                      alt={selectedInputFileName ?? 'Ausgewaehlte Bildvorlage'}
                      className="create-character-status-circle-image"
                    />
                  ) : (
                    <div className="create-character-status-circle-empty">
                      <div className="create-character-status-circle-icons">
                        <UploadOutlined />
                        <InboxOutlined />
                      </div>
                      <Text>Drag &amp; Drop</Text>
                      <Text type="secondary">oder Bild hochladen</Text>
                    </div>
                  )}

                  {isTransforming && (
                    <div className="create-character-status-circle-transform" aria-hidden="true">
                      <span className="create-character-status-circle-swirl swirl-layer-1" />
                      <span className="create-character-status-circle-swirl swirl-layer-2" />
                    </div>
                  )}

                  {finalProfileImageUrl && (
                    <img
                      src={finalProfileImageUrl}
                      alt="Generiertes Profilbild"
                      className={`create-character-status-circle-final-image ${
                        showFinalProfileImage ? 'is-visible' : ''
                      }`}
                      onLoad={() => setLoadedFinalProfileImageUrl(finalProfileImageUrl)}
                    />
                  )}

                  {flow.uploadLoading && (
                    <div className="create-character-status-circle-uploading" aria-hidden="true">
                      <LoadingOutlined />
                    </div>
                  )}
                </div>
                <Text type="secondary" className="create-character-status-circle-caption">
                  {selectedInputFileName
                    ? `Vorlage: ${selectedInputFileName}`
                    : 'Noch keine Bildvorlage ausgewaehlt'}
                </Text>
              </div>

              <Tag
                color={
                  flow.job?.phase === 'completed'
                    ? 'success'
                    : flow.job?.phase === 'failed'
                      ? 'error'
                      : flow.job
                        ? 'processing'
                        : 'default'
                }
              >
                {flow.job?.phase ?? 'waiting'}
              </Tag>
              <Text>{flow.job?.message ?? 'Noch nicht gestartet.'}</Text>
              <Progress
                percent={flow.progressPercent}
                size="small"
                status={flow.job?.phase === 'failed' ? 'exception' : undefined}
              />
            </Space>
          </Card>

          <Card className="create-character-card" title="Deine Eingaben">
            <Space direction="vertical" size="small" style={{ width: '100%' }}>
              <Text>
                Bereits vorhanden: {content.characters.length} Characters im Storytime-Universum.
              </Text>
              <div className="create-character-tag-group">
                {flow.pendingReferenceImages.map((image) => (
                  <Tag key={image.id} color="gold">
                    Ausgewaehlt: {image.file.name}
                  </Tag>
                ))}
                {flow.referenceImages.map((image) => (
                  <Tag key={image.id} color="blue">
                    Bildvorlage: {image.fileName}
                  </Tag>
                ))}
              </div>
              <Paragraph className="create-character-prompt-preview">
                {flow.compiledPrompt || 'Noch keine zusammengefassten Character-Notizen.'}
              </Paragraph>
            </Space>
          </Card>

          <Card className="create-character-card" title="Asset-Fortschritt">
            {flow.job?.assets?.length ? (
              <div className="create-character-assets">
                {flow.job.assets.map((asset) => (
                  <div key={asset.id} className="create-character-asset-row">
                    <span>{asset.type}</span>
                    <Tag
                      color={
                        asset.status === 'generated'
                          ? 'success'
                          : asset.status === 'failed'
                            ? 'error'
                            : asset.status === 'running'
                              ? 'processing'
                              : 'default'
                      }
                    >
                      {asset.status}
                    </Tag>
                  </div>
                ))}
              </div>
            ) : (
              <Text type="secondary">Noch keine geplanten Assets.</Text>
            )}
          </Card>

          {flow.job?.phase === 'completed' && flow.job.characterId && (
            <Card className="create-character-card" title="Ergebnis">
              <Space>
                <Link to={`/characters/${flow.job.characterId}`}>
                  <Button type="primary">Zum Character</Button>
                </Link>
                <Link to={`/characters/${flow.job.characterId}/story`}>
                  <Button>Story starten</Button>
                </Link>
              </Space>
            </Card>
          )}
        </aside>
      </div>
    </div>
  )
}
