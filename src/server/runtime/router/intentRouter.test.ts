import { describe, expect, it } from 'vitest'
import {
  detectRuntimeIntent,
  detectRuntimeIntentContextFlags,
  detectRuntimeToolExecutionIntent,
  isMemoryImageRequest,
} from './intentRouter.ts'

describe('detectRuntimeToolExecutionIntent', () => {
  it('mapped Character-Image Requests standardmaessig auf dry-run', () => {
    const intent = detectRuntimeToolExecutionIntent(
      'Kannst du per CLI Character Images vorbereiten?',
    )
    expect(intent).toEqual(
      expect.objectContaining({
        taskId: 'character_images_dry_run',
        dryRun: true,
      }),
    )
  })

  it('mapped explizite Execute Requests auf generate', () => {
    const intent = detectRuntimeToolExecutionIntent(
      'Bitte starte per CLI jetzt das Character-Images Generate.',
    )
    expect(intent).toEqual(
      expect.objectContaining({
        taskId: 'character_images_generate',
        dryRun: false,
      }),
    )
  })

  it('mapped Runtime-Smoke Requests inklusive Mode', () => {
    const intent = detectRuntimeToolExecutionIntent('Kannst du den runtime smoke test mode quiz ausfuehren?')
    expect(intent).toEqual(
      expect.objectContaining({
        taskId: 'runtime_smoke',
        dryRun: false,
        args: expect.objectContaining({
          mode: 'quiz',
        }),
      }),
    )
  })
})

describe('isMemoryImageRequest', () => {
  it('erkennt klassische Erinnerungsfragen mit Bildbezug', () => {
    expect(
      isMemoryImageRequest('Kannst du dich erinnern und das Bild von damals nochmal zeigen?'),
    ).toBe(true)
  })

  it('erkennt Personenbezug wie "hast du was mit Juna"', () => {
    expect(isMemoryImageRequest('Hast du etwas mit Juna erlebt?')).toBe(true)
  })

  it('erkennt Erinnerungsfragen zu anderen Personen', () => {
    expect(isMemoryImageRequest('Erinnerst du dich an andere Personen, die dabei waren?')).toBe(true)
  })

  it('erkennt Bildfragen mit Personenbezug auch ohne explizites "erinnern"', () => {
    expect(isMemoryImageRequest('Kannst du mir das Bild mit Juna zeigen?')).toBe(true)
  })

  it('interpretiert generische Formulierungen nicht als Personen-Erinnerung', () => {
    expect(isMemoryImageRequest('Kannst du mir ein Bild mit einem Drachen zeigen?')).toBe(false)
  })
})

describe('detectRuntimeIntentContextFlags', () => {
  it('liest Relationship-Flag aus expliziter Modell-Ausgabe', () => {
    expect(detectRuntimeIntentContextFlags('Relationship requested: true.')).toEqual(
      expect.objectContaining({
        relationshipsRequested: true,
      }),
    )
  })

  it('liest Activity-Flag aus JSON-aehnlicher Modell-Ausgabe', () => {
    expect(
      detectRuntimeIntentContextFlags('{ "activitiesRequested": true, "relationshipsRequested": false }'),
    ).toEqual(
      expect.objectContaining({
        activitiesRequested: true,
        relationshipsRequested: false,
      }),
    )
  })

  it('interpretiert freie User-Formulierung ohne Modell-Flag nicht als Tool-Request', () => {
    expect(
      detectRuntimeIntentContextFlags('Kannst du mir etwas ueber deine Beziehungen sagen?'),
    ).toEqual({
      relationshipsRequested: false,
      activitiesRequested: false,
    })
  })
})

describe('detectRuntimeIntent', () => {
  it('liest Skill-Entscheidung aus explizitem skillId-Flag', () => {
    expect(detectRuntimeIntent('{ "skillId": "run-quiz", "reason": "quiz-request" }', '')).toEqual({
      skillId: 'do-something',
      reason: 'quiz-request',
    })
  })

  it('routet Memory-Fragen auf remember-something', () => {
    expect(detectRuntimeIntent('Kannst du dich erinnern und das Bild nochmal zeigen?', '')).toEqual({
      skillId: 'remember-something',
      reason: 'memory-image-request',
    })
  })

  it('routet aeltere/veraenderte Bildwuensche stabil auf remember-something', () => {
    expect(detectRuntimeIntent('Zeig mir eine Aenderung, am besten eine aeltere.', '')).toEqual({
      skillId: 'remember-something',
      reason: 'older-change-memory-request',
    })
  })

  it('routet Glitzerstein-Anfragen stabil auf remember-something', () => {
    expect(detectRuntimeIntent('Finde mir einen Stein mit Glitzer in der Naehe.', '')).toEqual({
      skillId: 'remember-something',
      reason: 'glitter-stone-memory-request',
    })
  })

  it('liefert ohne explizite Modell-Entscheidung keinen Skill', () => {
    expect(detectRuntimeIntent('Kannst du mir was ueber deine Freunde sagen?', 'Klar!')).toBeNull()
  })
})
