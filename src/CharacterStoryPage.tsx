import { useCallback, useRef, type CSSProperties } from 'react'
import { Button, Drawer, Typography } from 'antd'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'
import type { StoryContent } from './content/types'
import VoiceChatButton from './VoiceChatButton'
import CharacterActivityStream from './CharacterActivityStream'
import useCharacterData from './useCharacterData'
import {
  readTextValue,
  readActivityDisplayValue,
  resolveActivitySubjectLabel,
  normalizeConversationMessageSummary,
  normalizeLegacyCharacterNamesInSummary,
  readMessageImageUrl,
  normalizeImageUrl,
  formatTimestamp,
  formatTracePayload,
  buildActivitySummary,
} from './characterTypes'
import { readCanonicalStoryText } from './storyText'

const { Title, Text } = Typography

type Props = {
  content: StoryContent
}

export default function CharacterStoryPage({ content }: Props) {

  const {
    id,
    navigate,
    character,
    heroUrl,
    allCharactersById,
    activeHeroUrl,
    incomingHeroUrl,
    isMemoryOverlayActive,
    isHeroParallaxEnabled,
    detailStyle,
    transitionToHeroUrl,
    handleHeroMouseMove,
    resetHeroParallax,
    setHeroViewMode,
    activityItems,
    activityStreamConnected,
    selectedConversationId,
    isConversationPanelOpen,
    openConversationPanel,
    closeConversationPanel,
    conversationDetails,
    conversationLoading,
    conversationError,
    conversationTimelineItems,
    copiedConversationText,
    copyConversationText,
    formatConversationRoleLabel,
  } = useCharacterData({ content, loadActivities: true })

  const activityOverlayRef = useRef<HTMLDivElement>(null)

  const handleScrollImageChange = useCallback(
    (imageUrl: string, item: { rawActivityType?: string }) => {
      setHeroViewMode('latest-activity')
      transitionToHeroUrl(imageUrl, {
        memoryOverlay:
          item.rawActivityType === 'conversation.image.recalled' ||
          item.rawActivityType === 'tool.image.recalled',
      })
    },
    [setHeroViewMode, transitionToHeroUrl],
  )

  if (!character) {
    return (
      <div className="character-detail-empty">
        <Title level={2}>Charakter nicht gefunden</Title>
        <Button type="primary" onClick={() => navigate('/characters')}>
          Alle Charaktere ansehen
        </Button>
      </div>
    )
  }

  return (
    <div
      className={`character-story-page ${
        activeHeroUrl ? 'character-story-has-hero' : ''
      } ${isHeroParallaxEnabled ? 'character-story-parallax' : ''} ${
        isMemoryOverlayActive ? 'character-story-memory-active' : ''
      }`}
      style={detailStyle}
      onMouseMove={handleHeroMouseMove}
      onMouseLeave={resetHeroParallax}
    >
      <div
        className={`character-story-hero-transition${incomingHeroUrl ? ' is-visible' : ''}`}
        style={incomingHeroUrl ? { '--character-next-hero-url': `url('${incomingHeroUrl}')` } as CSSProperties : undefined}
        aria-hidden="true"
      />
      <div className="character-story-memory-overlay" aria-hidden="true" />

      {!activeHeroUrl && (
        <div className="character-story-scene-placeholder">
          <Text className="character-story-scene-placeholder-text">
            Starte eine Unterhaltung, um die Geschichte zu erleben
          </Text>
        </div>
      )}

      <div className="character-story-right-stack">
        <div className="character-story-voice-chat">
          <VoiceChatButton character={character} conversationId={selectedConversationId} />
        </div>
        <div ref={activityOverlayRef} className="character-story-activity-overlay">
          <CharacterActivityStream
            items={activityItems}
            isLive={activityStreamConnected}
            onOpenConversation={openConversationPanel}
            scrollContainerRef={activityOverlayRef}
            onScrollImageChange={handleScrollImageChange}
            onSelectImage={(imageUrl, item) => {
              setHeroViewMode('latest-activity')
              transitionToHeroUrl(imageUrl, {
                memoryOverlay:
                  item.rawActivityType === 'conversation.image.recalled' ||
                  item.rawActivityType === 'tool.image.recalled',
              })
            }}
          />
        </div>
      </div>

      <Drawer
        title="Conversation"
        extra={
          selectedConversationId ? (
            <Button
              type="text"
              size="small"
              onClick={() => {
                void copyConversationText()
              }}
              icon={copiedConversationText ? <CheckOutlined /> : <CopyOutlined />}
              disabled={!conversationDetails || conversationDetails.messages.length === 0}
              title={
                copiedConversationText
                  ? 'Conversation-Text kopiert'
                  : 'Gesamten Conversation-Text kopieren'
              }
              aria-label={
                copiedConversationText
                  ? 'Conversation-Text kopiert'
                  : 'Gesamten Conversation-Text in Zwischenablage kopieren'
              }
            />
          ) : null
        }
        placement="right"
        open={isConversationPanelOpen}
        onClose={closeConversationPanel}
        rootClassName="conversation-drawer"
        width={440}
        styles={{
          content: { background: '#000', boxShadow: 'none' },
          header: { background: '#000' },
          body: { background: '#000' },
          mask: { background: 'transparent' },
          wrapper: { background: 'transparent' },
        }}
      >
        {conversationLoading && <p className="conversation-drawer-state">Lade Conversation...</p>}
        {!conversationLoading && conversationError && (
          <p className="conversation-drawer-state conversation-drawer-state-error">{conversationError}</p>
        )}
        {!conversationLoading && !conversationError && conversationDetails && (
          <div className="conversation-drawer-content">
            <p className="conversation-drawer-meta">
              <strong>Gestartet:</strong> {formatTimestamp(conversationDetails.conversation.startedAt)}
            </p>
            {conversationDetails.conversation.endedAt && (
              <p className="conversation-drawer-meta">
                <strong>Beendet:</strong> {formatTimestamp(conversationDetails.conversation.endedAt)}
              </p>
            )}
            <div className="conversation-drawer-messages">
              {conversationTimelineItems.length === 0 ? (
                <p className="conversation-drawer-state">Keine Events gespeichert.</p>
              ) : (
                conversationTimelineItems.map((timelineItem) => {
                  if (timelineItem.kind === 'message') {
                    const message = timelineItem.message
                    const messageImageUrl = normalizeImageUrl(readMessageImageUrl(message))
                    return (
                      <div key={timelineItem.id} className="conversation-drawer-message">
                        <p className="conversation-drawer-message-meta">
                          <span>{formatConversationRoleLabel(message.role)}</span>
                          <span>{formatTimestamp(message.createdAt)}</span>
                        </p>
                        <p className="conversation-drawer-message-content">{message.content}</p>
                        {messageImageUrl && (
                          <button
                            type="button"
                            className="conversation-drawer-image-button"
                            onClick={() => transitionToHeroUrl(messageImageUrl)}
                            aria-label="Bild als Szene anzeigen"
                          >
                            <img
                              src={messageImageUrl}
                              alt="Generiertes Conversation-Bild"
                              className="conversation-drawer-image"
                            />
                          </button>
                        )}
                      </div>
                    )
                  }

                  const activity = timelineItem.activity
                  const subjectLabel = resolveActivitySubjectLabel(activity, character.name)
                  const objectLabel = readActivityDisplayValue(activity.object) ?? 'Aktivitaet'
                  const summary = normalizeConversationMessageSummary(
                    activity,
                    normalizeLegacyCharacterNamesInSummary({
                      activity,
                      summary:
                        readCanonicalStoryText({
                          activityType: activity.activityType,
                          storySummary: activity.storySummary,
                          metadata: activity.metadata,
                        }) ?? buildActivitySummary(activity, character.name, subjectLabel, objectLabel),
                      characterName: character.name,
                      allCharactersById,
                    }),
                    character.name,
                  )
                  const traceInput = formatTracePayload(activity.metadata.input)
                  const traceOutput = formatTracePayload(activity.metadata.output)
                  const traceError = readTextValue(activity.metadata.error)
                  const traceStage = readTextValue(activity.metadata.traceStage)
                  const traceKind = readTextValue(activity.metadata.traceKind)
                  const traceSource = readTextValue(activity.metadata.traceSource)
                  const isTrace = activity.activityType.startsWith('trace.')
                  return (
                    <div key={timelineItem.id} className="conversation-drawer-message conversation-drawer-event">
                      <p className="conversation-drawer-message-meta">
                        <span>{activity.activityType}</span>
                        <span>{formatTimestamp(activity.occurredAt || activity.createdAt)}</span>
                      </p>
                      <p className="conversation-drawer-message-content">{summary}</p>
                      {isTrace ? (
                        <p className="conversation-drawer-trace-meta">
                          {traceStage ?? '-'} / {traceKind ?? '-'} / {traceSource ?? '-'}
                        </p>
                      ) : null}
                      {traceInput ? (
                        <div className="conversation-drawer-trace-block">
                          <p className="conversation-drawer-trace-label">Input</p>
                          <pre className="conversation-drawer-trace-pre">{traceInput}</pre>
                        </div>
                      ) : null}
                      {traceOutput ? (
                        <div className="conversation-drawer-trace-block">
                          <p className="conversation-drawer-trace-label">Output</p>
                          <pre className="conversation-drawer-trace-pre">{traceOutput}</pre>
                        </div>
                      ) : null}
                      {traceError ? (
                        <div className="conversation-drawer-trace-block">
                          <p className="conversation-drawer-trace-label">Error</p>
                          <pre className="conversation-drawer-trace-pre">{traceError}</pre>
                        </div>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  )
}
