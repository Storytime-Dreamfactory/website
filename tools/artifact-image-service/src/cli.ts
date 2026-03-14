import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateArtifactImagesFromManifest } from './generateArtifactImagesFromManifest.ts'
import type { FluxModel } from './types.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))

const usage = `Usage:
  npm run artifact-images:dry-run
  npm run artifact-images:generate

Options:
  --manifest <path>            Path to content manifest (default: ./public/content-manifest.json)
  --style-reference <path>     Repeatable local file path to style/reference images
  --artifact-reference <path>  Repeatable local file path to artifact reference images
  --output-root <path>         Root directory for generated assets (default: public/content/artifacts)
  --model <name>               Default FLUX model (default: flux-2-pro)
  --hero-model <name>          FLUX model for hero renders (default: flux-2-pro)
  --seed <number>              Base seed (default: 4242)
  --poll-interval-ms <number>  Polling interval (default: 1000)
  --max-poll-attempts <num>    Poll attempt limit (default: 120)
  --overwrite                  Overwrite already generated files
  --dry-run                    Build prompts and manifests only`

const parseArgs = (argv: string[]) => {
  const options = {
    contentManifestPath: path.resolve(workspaceRoot, 'public/content-manifest.json'),
    outputRoot: path.resolve(workspaceRoot, 'public/content/artifacts'),
    styleReferencePaths: [] as string[],
    artifactReferencePaths: [] as string[],
    defaultModel: 'flux-2-pro' as FluxModel,
    heroModel: 'flux-2-pro' as FluxModel,
    dryRun: false,
    overwrite: false,
    baseSeed: 4242,
    pollIntervalMs: 1000,
    maxPollAttempts: 120,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--manifest') {
      options.contentManifestPath = path.resolve(argv[index + 1] ?? '')
      index += 1
      continue
    }

    if (arg === '--style-reference') {
      options.styleReferencePaths.push(path.resolve(argv[index + 1] ?? ''))
      index += 1
      continue
    }

    if (arg === '--artifact-reference') {
      options.artifactReferencePaths.push(path.resolve(argv[index + 1] ?? ''))
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

  return options
}

const run = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2))
  const result = await generateArtifactImagesFromManifest({
    ...options,
    onArtifactCompleted: (event) => {
      if (event.ok) {
        console.log(`OK: ${event.artifactPath}`)
      } else {
        console.log(`FAILED: ${event.artifactPath} -> ${event.message}`)
      }
    },
  })

  const failed = result.artifacts.filter((entry) => !entry.ok)
  const successCount = result.artifacts.length - failed.length
  console.log(
    `${options.dryRun ? 'Dry run complete' : 'Generation complete'}: ${successCount}/${result.artifacts.length} artifacts successful.`,
  )

  if (failed.length > 0) {
    process.exitCode = 1
  }
}

void run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
