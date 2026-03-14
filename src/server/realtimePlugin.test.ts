import { describe, expect, it } from 'vitest'
import {
  buildVoiceProfileInstructionsBlock,
  resolveRealtimeVoiceFromCharacterYaml,
} from './realtimePlugin.ts'

describe('realtimePlugin voice wiring', () => {
  it('resolves allowed voice from character yaml', () => {
    const voice = resolveRealtimeVoiceFromCharacterYaml({ voice: 'marin' })
    expect(voice).toBe('marin')
  })

  it('falls back to coral for invalid voice', () => {
    const voice = resolveRealtimeVoiceFromCharacterYaml({ voice: 'invalid-voice' })
    expect(voice).toBe('coral')
  })

  it('builds instruction block with injected voice profile fields', () => {
    const block = buildVoiceProfileInstructionsBlock({
      voice_profile: {
        identity: 'Freundliche Entdeckerin',
        demeanor: 'ermutigend',
        tone: 'warm',
        enthusiasm_level: 'hoch',
        formality_level: 'locker',
        emotion_level: 'ausdrucksstark',
        filler_words: 'occasionally',
        pacing: 'lebendig',
      },
    })

    expect(block).toContain('Identitaet: Freundliche Entdeckerin')
    expect(block).toContain('Grundhaltung: ermutigend')
  })
})
