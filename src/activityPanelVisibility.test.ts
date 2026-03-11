import { describe, expect, it } from 'vitest'
import {
  isPanelConversationMessageActivity,
  isPanelConversationSummaryActivity,
  isPanelImageActivity,
  shouldShowActivityInPanel,
} from './activityPanelVisibility.ts'

describe('activityPanelVisibility', () => {
  it('zeigt oeffentliche Bild-Activities im Panel', () => {
    expect(
      isPanelImageActivity({
        activityType: 'conversation.image.generated',
        isPublic: true,
      }),
    ).toBe(true)
  })

  it('zeigt oeffentliche User- und Assistant-Messages im Panel', () => {
    expect(
      isPanelConversationMessageActivity({
        activityType: 'conversation.message.created',
        isPublic: true,
        object: { role: 'user' },
      }),
    ).toBe(true)

    expect(
      isPanelConversationMessageActivity({
        activityType: 'conversation.message.created',
        isPublic: true,
        object: { role: 'assistant' },
      }),
    ).toBe(true)
  })

  it('zeigt oeffentliche Conversation-End-Summaries im Panel', () => {
    expect(
      isPanelConversationSummaryActivity({
        activityType: 'conversation.story.summarized',
        isPublic: true,
      }),
    ).toBe(true)
  })

  it('blendet andere Activity-Typen aus dem Panel aus', () => {
    expect(
      shouldShowActivityInPanel({
        activityType: 'conversation.started',
        isPublic: false,
        object: {},
        metadata: {},
      }),
    ).toBe(false)

    expect(
      shouldShowActivityInPanel({
        activityType: 'runtime.skill.routed',
        isPublic: false,
        object: {},
        metadata: {},
      }),
    ).toBe(false)

    expect(
      shouldShowActivityInPanel({
        activityType: 'conversation.message.created',
        isPublic: true,
        object: { role: 'system' },
        metadata: {},
      }),
    ).toBe(false)
  })
})
