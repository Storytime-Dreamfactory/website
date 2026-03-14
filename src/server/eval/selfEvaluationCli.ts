import path from 'node:path'
import { runSelfEvaluation } from './selfEvaluationRunner.ts'
import {
  listSelfEvaluationScenarioIds,
  parseSelfEvaluationScenarioIds,
} from './selfEvaluationScenarios.ts'

const DEFAULT_CHARACTER_ID = 'yoko'
const DEFAULT_OUTPUT_DIR = 'Eval'
const DEFAULT_RUNS = 1
const DEFAULT_BASE_URL = 'http://localhost:5173'

const readArg = (name: string): string | undefined => {
  const token = `--${name}=`
  const entry = process.argv.find((part) => part.startsWith(token))
  return entry ? entry.slice(token.length).trim() : undefined
}

const readIntArg = (name: string, fallback: number): number => {
  const value = readArg(name)
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

const run = async (): Promise<void> => {
  const characterId = readArg('character') || DEFAULT_CHARACTER_ID
  const userId = readArg('user-id') || 'yoko'
  const scenarioIds = parseSelfEvaluationScenarioIds(readArg('scenarios'))
  const runs = readIntArg('runs', DEFAULT_RUNS)
  const modeArg = (readArg('mode') || 'cli').toLowerCase()
  const executionMode = modeArg === 'http' ? 'http' : 'cli'
  const baseUrl = readArg('base-url') || DEFAULT_BASE_URL
  const maxTurnsArg = readArg('max-turns')
  const maxTurns = maxTurnsArg ? readIntArg('max-turns', 1) : undefined
  const outputDirectory = path.resolve(process.cwd(), readArg('output') || DEFAULT_OUTPUT_DIR)

  console.log(
    `[eval] character=${characterId} mode=${executionMode} scenarios=${scenarioIds.join(',')} runs=${runs} output=${outputDirectory}`,
  )
  if (scenarioIds.length === 0) {
    throw new Error(
      `Keine gueltigen Szenarien angegeben. Erlaubt: ${listSelfEvaluationScenarioIds().join(', ')}`,
    )
  }

  const results = await runSelfEvaluation({
    characterId,
    userId,
    scenarioIds,
    runs,
    outputDirectory,
    maxTurns,
    executionMode,
    baseUrl,
  })

  console.log('\n[eval] Fertig. Reports:')
  for (const result of results) {
    console.log(
      `- e2e#${result.runIndex} mode=${result.executionMode} scenarios=${result.scenarioIds.join(',')} score=${result.score}/10 conversation=${result.conversationId}`,
    )
    console.log(`  ${result.reportPath}`)
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[eval] Fehler: ${message}`)
  console.error('Hinweis: Stelle sicher, dass DB und API-Keys korrekt gesetzt sind.')
  process.exitCode = 1
})
