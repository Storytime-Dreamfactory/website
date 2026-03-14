import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateCharacterImages } from './generateCharacterImages.ts'
import type { FluxModel, GenerateCharacterImagesOptions } from './types.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

const usage = `Usage:
  npm run character-images:dry-run -- --character ./content/characters/nola/character.yaml --style-reference /absolute/path/to/reference.png
  npm run character-images:generate -- --character ./content/characters/nola/character.yaml --style-reference /absolute/path/to/reference.png

Options:
  --character <path>           Required path to the character YAML file
  --style-reference <path>     Repeatable local file path to grounding/style images
  --output-root <path>         Root directory for generated assets (default: public/content/characters)
  --model <name>               Default FLUX model (default: flux-2-pro)
  --hero-model <name>          FLUX model for hero renders (default: flux-2-pro)
  --seed <number>              Base seed (default: 4242)
  --poll-interval-ms <number>  Polling interval (default: 1000)
  --max-poll-attempts <num>    Poll attempt limit (default: 120)
  --overwrite                  Overwrite already generated files
  --dry-run                    Build prompts and manifest only`

const parseArgs = (argv: string[]): GenerateCharacterImagesOptions => {
  const options: GenerateCharacterImagesOptions = {
    characterPath: '',
    outputRoot: path.resolve(workspaceRoot, 'public/content/characters'),
    styleReferencePaths: [],
    characterReferencePaths: [],
    defaultModel: 'flux-2-pro',
    heroModel: 'flux-2-pro',
    dryRun: false,
    overwrite: false,
    baseSeed: 4242,
    pollIntervalMs: 1000,
    maxPollAttempts: 120,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--character') {
      options.characterPath = path.resolve(argv[index + 1] ?? '')
      index += 1
      continue
    }

    if (arg === '--style-reference') {
      options.styleReferencePaths.push(path.resolve(argv[index + 1] ?? ''))
      index += 1
      continue
    }

    if (arg === '--output-root') {
      options.outputRoot = path.resolve(argv[index + 1] ?? '')
      index += 1
      continue
    }

    if (arg === '--model') {
      options.defaultModel = (argv[index + 1] ?? options.defaultModel) as FluxModel
      index += 1
      continue
    }

    if (arg === '--hero-model') {
      options.heroModel = (argv[index + 1] ?? options.heroModel) as FluxModel
      index += 1
      continue
    }

    if (arg === '--seed') {
      options.baseSeed = Number(argv[index + 1] ?? options.baseSeed)
      index += 1
      continue
    }

    if (arg === '--poll-interval-ms') {
      options.pollIntervalMs = Number(argv[index + 1] ?? options.pollIntervalMs)
      index += 1
      continue
    }

    if (arg === '--max-poll-attempts') {
      options.maxPollAttempts = Number(argv[index + 1] ?? options.maxPollAttempts)
      index += 1
      continue
    }

    if (arg === '--overwrite') {
      options.overwrite = true
      continue
    }

    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      console.log(usage)
      process.exit(0)
    }
  }

  if (!options.characterPath) {
    throw new Error('Missing required --character argument')
  }

  if (!Number.isFinite(options.baseSeed)) {
    throw new Error('Seed must be a valid number')
  }

  return options
}

const run = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2))
  const { manifestPath } = await generateCharacterImages({
    ...options,
    onProgress: (event) => {
      if (event.type === 'asset-started') {
        console.log(`Generating ${event.asset.type} with ${event.asset.model}...`)
      }
    },
  })
  console.log(`${options.dryRun ? 'Dry run complete.' : 'Generation complete.'} Manifest written to ${manifestPath}`)
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
