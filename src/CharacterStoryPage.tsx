import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Button, Card, Drawer, Segmented, Typography } from 'antd'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'
import type { StoryContent } from './content/types'
import VoiceChatButton from './VoiceChatButton'
import CharacterActivityStream from './CharacterActivityStream'
import useCharacterData from './useCharacterData'
import useConversationStream from './useConversationStream'
import ProgressiveImage from './ProgressiveImage'
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
const LEARNING_GOAL_CARD_IMAGE = '/generated/skills-finja-nola-learning-background.png'

type Props = {
  content: StoryContent
}

const readConversationLearningGoalId = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const record = metadata as Record<string, unknown>
  const ids = Array.isArray(record.learningGoalIds)
    ? record.learningGoalIds.filter((item): item is string => typeof item === 'string')
    : []
  const firstId = ids.map((item) => item.trim()).find((item) => item.length > 0)
  if (firstId) return firstId
  const singleId = typeof record.learningGoalId === 'string' ? record.learningGoalId.trim() : ''
  return singleId || null
}

export default function CharacterStoryPage({ content }: Props) {

  const {
    navigate,
    character,
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
    hasMoreActivities,
    activityLoadMorePending,
    loadMoreActivities,
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

  const conversationStream = useConversationStream(
    isConversationPanelOpen ? selectedConversationId : null,
  )
  const [drawerTab, setDrawerTab] = useState<'timeline' | 'notepad'>('timeline')

  const mergedConversationTimelineItems = useMemo(() => {
    if (!conversationStream.connected) return conversationTimelineItems

    const existingMessageIds = new Set(
      conversationTimelineItems
        .filter((item) => item.kind === 'message')
        .map((item) => item.message.messageId),
    )
    const existingActivityIds = new Set(
      conversationTimelineItems
        .filter((item) => item.kind === 'activity')
        .map((item) => item.activity.activityId),
    )

    const toMs = (iso: string): number => {
      const ms = new Date(iso).getTime()
      return Number.isFinite(ms) ? ms : 0
    }

    const newMessages = conversationStream.liveMessages
      .filter((msg) => !existingMessageIds.has(msg.messageId))
      .map((msg) => ({
        kind: 'message' as const,
        id: `msg-live-${msg.messageId}`,
        timestampMs: toMs(msg.createdAt),
        message: msg,
      }))
    const newActivities = conversationStream.liveActivities
      .filter((act) => !existingActivityIds.has(act.activityId))
      .map((act) => ({
        kind: 'activity' as const,
        id: `act-live-${act.activityId}`,
        timestampMs: toMs(act.occurredAt || act.createdAt),
        activity: act,
      }))

    if (newMessages.length === 0 && newActivities.length === 0) return conversationTimelineItems

    return [
      ...conversationTimelineItems,
      ...newMessages,
      ...newActivities,
    ].sort((a, b) => b.timestampMs - a.timestampMs)
  }, [conversationTimelineItems, conversationStream])

  const activityOverlayRef = useRef<HTMLDivElement>(null)
  const [selectedLearningGoalId, setSelectedLearningGoalId] = useState<string | null>(null)
  const [isLearningGoalPickerOpen, setIsLearningGoalPickerOpen] = useState(false)
  const sortedLearningGoals = useMemo(() => {
    const suitableIds = new Set(character?.learningFunction?.suitableLearningGoals ?? [])
    return content.learningGoals
      .slice()
      .sort((left, right) => {
        const leftSuitable = suitableIds.has(left.id) ? 0 : 1
        const rightSuitable = suitableIds.has(right.id) ? 0 : 1
        if (leftSuitable !== rightSuitable) return leftSuitable - rightSuitable
        return left.name.localeCompare(right.name, 'de')
      })
  }, [character?.learningFunction?.suitableLearningGoals, content.learningGoals])
  const selectedLearningGoal = useMemo(
    () => content.learningGoals.find((goal) => goal.id === selectedLearningGoalId) ?? null,
    [content.learningGoals, selectedLearningGoalId],
  )
  const selectedLearningGoalSummary = useMemo(() => {
    if (!selectedLearningGoal) return 'Tippe, um ein Lernziel auszuwaehlen'
    return [
      selectedLearningGoal.ageRange.length > 0 ? `Alter ${selectedLearningGoal.ageRange.join(' · ')}` : null,
      selectedLearningGoal.subject ? selectedLearningGoal.subject : null,
      selectedLearningGoal.topicGroup ? selectedLearningGoal.topicGroup : null,
    ]
      .filter((value): value is string => Boolean(value))
      .join(' · ')
  }, [selectedLearningGoal])

  useEffect(() => {
    if (!selectedConversationId || !conversationDetails) return
    setSelectedLearningGoalId(readConversationLearningGoalId(conversationDetails.conversation.metadata))
    setIsLearningGoalPickerOpen(false)
  }, [selectedConversationId, conversationDetails])

  const handleScrollImageChange = useCallback(
    (imageUrl: string, item: { rawActivityType?: string }) => {
      setHeroViewMode('latest-activity')
      transitionToHeroUrl(imageUrl, {
        persistToCache: true,
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
          <div className="character-story-learning-goal-picker">
            <button
              type="button"
              className="character-story-learning-goal-trigger"
              onClick={() => setIsLearningGoalPickerOpen(true)}
            >
              <Card className="content-card character-story-learning-goal-content-card" bordered={false}>
                <div className="content-card-media">
                  <ProgressiveImage
                    src={LEARNING_GOAL_CARD_IMAGE}
                    alt={selectedLearningGoal?.name ?? 'Lernziel hinzufuegen'}
                    className="content-card-image"
                    loading="lazy"
                    fetchPriority="low"
                  />
                  <div className="content-card-overlay character-story-learning-goal-overlay">
                    <div className="character-story-learning-goal-overlay-copy">
                      <Text className="character-story-learning-goal-kicker">
                        {selectedLearningGoal ? 'Aktives Lernziel' : 'Lernziel'}
                      </Text>
                      <Title level={4} className="content-card-title character-story-learning-goal-card-title">
                        {selectedLearningGoal?.name ?? 'Lernziel hinzufuegen'}
                      </Title>
                      <Text className="character-story-learning-goal-overlay-meta">
                        {selectedLearningGoalSummary}
                      </Text>
                    </div>
                  </div>
                </div>
              </Card>
            </button>
          </div>
          <VoiceChatButton
            character={character}
            conversationId={selectedConversationId}
            selectedLearningGoalId={selectedLearningGoalId}
            enableTextChat
            textChatMountSelector="#activity-panel-chat-composer"
          />
        </div>
        <div ref={activityOverlayRef} className="character-story-activity-overlay">
          <CharacterActivityStream
            items={activityItems}
            isLive={activityStreamConnected}
            onOpenConversation={openConversationPanel}
            scrollContainerRef={activityOverlayRef}
            onScrollImageChange={handleScrollImageChange}
            hasMoreItems={hasMoreActivities}
            isLoadingMore={activityLoadMorePending}
            onLoadMore={loadMoreActivities}
          />
          <div id="activity-panel-chat-composer" className="character-story-activity-chat-slot" />
        </div>
      </div>

      <Drawer
        title="Lernziel auswaehlen"
        placement="right"
        open={isLearningGoalPickerOpen}
        onClose={() => setIsLearningGoalPickerOpen(false)}
        rootClassName="conversation-drawer character-story-learning-goal-drawer"
        width={440}
        styles={{
          content: { background: '#000', boxShadow: 'none' },
          header: { background: '#000' },
          body: { background: '#000' },
          mask: { background: 'rgba(0, 0, 0, 0.35)' },
          wrapper: { background: 'transparent' },
        }}
      >
        <div className="character-story-learning-goal-drawer-head">
          <Text className="character-story-learning-goal-drawer-copy">
            Waehle ein Lernziel, damit der Character die Session daran ausrichten kann.
          </Text>
          {selectedLearningGoal ? (
            <Button
              type="text"
              size="small"
              className="character-story-learning-goal-clear-button"
              onClick={() => {
                setSelectedLearningGoalId(null)
                setIsLearningGoalPickerOpen(false)
              }}
            >
              Lernziel entfernen
            </Button>
          ) : null}
        </div>
        <div className="card-grid character-story-learning-goal-grid">
          {sortedLearningGoals.map((goal) => {
            const cardSummary = [
              goal.ageRange.length > 0 ? `Alter ${goal.ageRange.join(' · ')}` : null,
              goal.subject ? goal.subject : null,
              goal.topicGroup ? goal.topicGroup : null,
            ]
              .filter((value): value is string => Boolean(value))
              .join(' · ')
            return (
              <button
                key={goal.id}
                type="button"
                className={`character-story-learning-goal-grid-button${
                  selectedLearningGoalId === goal.id ? ' is-selected' : ''
                }`}
                onClick={() => {
                  setSelectedLearningGoalId(goal.id)
                  setIsLearningGoalPickerOpen(false)
                }}
              >
                <Card className="content-card character-story-learning-goal-content-card" bordered={false}>
                  <div className="content-card-media">
                    <ProgressiveImage
                      src={LEARNING_GOAL_CARD_IMAGE}
                      alt={goal.name}
                      className="content-card-image"
                      loading="lazy"
                      fetchPriority="low"
                    />
                    <div className="content-card-overlay character-story-learning-goal-overlay">
                      <div className="character-story-learning-goal-overlay-copy">
                        <Text className="character-story-learning-goal-kicker">Lernziel</Text>
                        <Title level={4} className="content-card-title character-story-learning-goal-card-title">
                          {goal.name}
                        </Title>
                        <Text className="character-story-learning-goal-overlay-meta">{cardSummary}</Text>
                      </div>
                    </div>
                  </div>
                </Card>
              </button>
            )
          })}
        </div>
      </Drawer>

      <Drawer
        title="Conversation"
        extra={
          <div className="conversation-drawer-extra">
            {conversationStream.connected && (
              <span className="conversation-drawer-live-dot" title="Live verbunden" />
            )}
            {selectedConversationId ? (
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
            ) : null}
          </div>
        }
        placement="right"
        open={isConversationPanelOpen}
        onClose={() => {
          closeConversationPanel()
          setDrawerTab('timeline')
        }}
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
        <Segmented
          value={drawerTab}
          onChange={(value) => setDrawerTab(value as 'timeline' | 'notepad')}
          options={[
            { label: 'Timeline', value: 'timeline' },
            { label: 'Notepad', value: 'notepad' },
          ]}
          block
          className="conversation-drawer-tabs"
        />

        {drawerTab === 'notepad' && (
          <div className="conversation-drawer-notepad">
            {conversationStream.notepadText ? (
              <>
                <pre className="conversation-drawer-notepad-content">{conversationStream.notepadText}</pre>
                {conversationStream.notepadUpdatedAt && (
                  <p className="conversation-drawer-notepad-updated">
                    Zuletzt aktualisiert: {formatTimestamp(conversationStream.notepadUpdatedAt)}
                  </p>
                )}
              </>
            ) : (
              <p className="conversation-drawer-state">
                Das Notepad ist leer. Es wird automatisch aktualisiert, wenn der Character Plaene erstellt oder Notizen macht.
              </p>
            )}
          </div>
        )}

        {drawerTab === 'timeline' && (
          <>
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
                  {mergedConversationTimelineItems.length === 0 ? (
                    <p className="conversation-drawer-state">Keine Events gespeichert.</p>
                  ) : (
                    mergedConversationTimelineItems.map((timelineItem) => {
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
                                <ProgressiveImage
                                  src={messageImageUrl}
                                  alt="Generiertes Conversation-Bild"
                                  className="conversation-drawer-image"
                                  loading="lazy"
                                  fetchPriority="low"
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
          </>
        )}
      </Drawer>
    </div>
  )
}
