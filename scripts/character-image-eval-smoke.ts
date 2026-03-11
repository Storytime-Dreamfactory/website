import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveCharacterYaml } from '../tools/character-image-service/src/saveCharacterYaml.ts'
import { generateCharacterImages } from '../tools/character-image-service/src/generateCharacterImages.ts'
import { evaluateGeneratedCharacterImages } from '../tools/character-image-service/src/imageEvaluationService.ts'
import { deleteCharacterArtifacts } from '../tools/character-image-service/src/deleteCharacterArtifacts.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)))

const FALLBACK_STYLE_REFERENCE = path.resolve(
  workspaceRoot,
  'public/generated/storytime-backgrounds/storytime-background-twilight-forest-close-4x3-hd.jpg',
)

const uniqueId = `smoke-${Date.now()}`
const shouldRunEvaluation = process.argv.includes('--with-eval')

const buildSmokeYaml = (characterId: string): string => `
id: ${characterId}
name: Rauchi
kurzbeschreibung: >
  Rauchi ist ein kleiner mutiger Waschbaer mit rotem Schal, grossen freundlichen Augen
  und einer warmen Abenteuerlaune.
basis:
  age_hint: kindlich
  species: Waschbaer
  role_archetype: helper
erscheinung:
  body_shape: klein und rundlich
  colors:
    - graublau
    - creme
    - rot
  hair_or_fur:
    color: graublau
    texture: weich
    length: kurz
  eyes:
    color: dunkelbraun
    expression: freundlich und wach
  distinctive_features:
    - roter Schal
    - runde Ohren
    - kleine leuchtende Pfotenabdruecke am Schalrand
  clothing_style: kleiner Abenteuerlook mit weichem Schal
persoenlichkeit:
  core_traits:
    - hilfsbereit
    - mutig
    - vorsichtig
  temperament: lebhaft
  social_style: offen
  strengths:
    - merkt schnell, wenn jemand Trost braucht
    - bleibt freundlich
  weaknesses:
    - zweifelt erst an sich
    - versteckt sich bei lautem Grollen
  quirks:
    - ordnet kleine Steine nach Farben
story_psychology:
  visible_goal: anderen bei kleinen Abenteuern helfen
  deeper_need: sich gebraucht fuehlen
  fear: dunkle Gewitterwolken
  insecurity: Ich bin vielleicht zu klein fuer grosse Aufgaben.
  stress_response: hesitate_then_try
  growth_direction: lernt, trotz Unsicherheit den ersten Schritt zu machen
learning_function:
  teaching_roles:
    - model
    - helper
  suitable_learning_goals:
    - courage
    - kindness
  explanation_style: playful
herkunft:
  geburtsort: Morgenlicht-Hain
  aufgewachsen_in:
    - Morgenlicht-Hain
    - Fluestertal
  kulturelle_praegung:
    - gemeinsames Erzaehlen am Abendfeuer
    - achtsames Leben im Wald
  religion_oder_weltbild: glaubt, dass kleine gute Taten Licht in den Tag bringen
  historische_praegung:
    - kennt alte Weggeschichten aus dem Wald
  notizen: Die Herkunft soll Werte, Sprache und Haltung sanft praegen.
relationships:
  characters: []
  places: []
bilder:
  standard_figur: {}
  hero_image: {}
  portrait: {}
  profilbild: {}
  weitere_bilder: []
tags:
  - warm
  - helper
  - courage
  - forest
metadata:
  active: true
  created_at: "2026-03-09"
  updated_at: "2026-03-09"
  version: 1
`

const resolveStyleReferencePaths = (): string[] => {
  const configured = process.env.STORYTIME_STYLE_REFERENCE_PATH
  const candidates = [configured, FALLBACK_STYLE_REFERENCE].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
  return [...new Set(candidates)]
}

const run = async (): Promise<void> => {
  if (!process.env.BFL_API_KEY) {
    throw new Error('BFL_API_KEY fehlt fuer den Smoke-Test.')
  }
  if (shouldRunEvaluation && !process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY fehlt fuer den Smoke-Test.')
  }

  const styleGuideText = shouldRunEvaluation
    ? await readFile(path.resolve(workspaceRoot, 'docs/visual-style-guide.md'), 'utf8')
    : ''
  const styleReferencePaths = resolveStyleReferencePaths()
  if (styleReferencePaths.length === 0) {
    throw new Error('Keine Style-Referenz verfuegbar fuer den Smoke-Test.')
  }

  let characterId = uniqueId

  try {
    const saved = await saveCharacterYaml(buildSmokeYaml(uniqueId))
    characterId = saved.characterId

    const { manifest } = await generateCharacterImages({
      characterPath: saved.contentPath,
      outputRoot: path.resolve(workspaceRoot, 'public/content/characters'),
      styleReferencePaths,
      characterReferencePaths: [],
      defaultModel: 'flux-2-klein-4b',
      heroModel: 'flux-2-klein-4b',
      dryRun: false,
      overwrite: true,
      baseSeed: 4242,
      pollIntervalMs: 1000,
      maxPollAttempts: 120,
      onProgress: (event) => {
        if (event.type === 'asset-started') {
          console.log(`Generiere ${event.asset.type}...`)
        }
      },
    })

    if (!shouldRunEvaluation) {
      console.log(
        JSON.stringify(
          {
            generated: true,
            evaluated: false,
            assetCount: manifest.assets.length,
            characterId,
          },
          null,
          2,
        ),
      )
      return
    }

    const evaluation = await evaluateGeneratedCharacterImages({
      manifest,
      styleGuideText,
    })

    console.log(JSON.stringify(evaluation, null, 2))

    if (!evaluation.pass) {
      throw new Error('Mindestens ein Bild hat die Storytime-Evaluation nicht bestanden.')
    }
  } finally {
    await deleteCharacterArtifacts(characterId)
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
