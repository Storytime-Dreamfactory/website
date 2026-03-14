import { describe, expect, it } from 'vitest'
import { buildLocalFallbackResponse } from './useCharacterCreationFlow'

describe('buildLocalFallbackResponse', () => {
  it('markiert den Flow als bereit bei genug User-Kontext', () => {
    const result = buildLocalFallbackResponse([
      { role: 'assistant', text: 'Hallo' },
      {
        role: 'user',
        text: 'Ein mutiger kleiner Fuchs mit gruenem Mantel, der oft zweifelt, aber seine Freunde schuetzt.',
      },
    ])

    expect(result.isReady).toBe(true)
    expect(result.compiledPrompt).toContain('Fuchs')
  })

  it('bleibt im Fragestatus bei kurzem Input', () => {
    const result = buildLocalFallbackResponse([{ role: 'user', text: 'Ein Fuchs.' }])
    expect(result.isReady).toBe(false)
    expect(result.reply).toContain('Ich brauche noch etwas mehr')
  })
})
