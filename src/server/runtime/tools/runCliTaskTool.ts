import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHARACTER_AGENT_TOOLS } from '../../characterAgentDefinitions.ts'
import { trackTraceActivitySafely } from '../../traceActivity.ts'
import type { RuntimeToolHandler } from './runtimeToolTypes.ts'
import { trackRuntimeToolActivitySafely } from './runtimeToolActivityLogger.ts'

const workspaceRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const outputMaxBufferBytes = 1024 * 1024

export const CLI_TASK_IDS = {
  characterImagesDryRun: 'character_images_dry_run',
  characterImagesGenerate: 'character_images_generate',
  runtimeSmoke: 'runtime_smoke',
} as const

export type CliTaskId = (typeof CLI_TASK_IDS)[keyof typeof CLI_TASK_IDS]

type RunCliTaskToolInput = {
  taskId: CliTaskId
  args?: Record<string, unknown>
  dryRun?: boolean
}

type RunCliTaskToolOutput = {
  ok: boolean
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  commandPreview: string
}

type ResolvedCommand = {
  command: string
  args: string[]
  timeoutMs: number
  commandPreview: string
}

class CliTaskValidationError extends Error {}

const isPathInsideWorkspace = (rawPath: string): boolean => {
  const absolutePath = path.resolve(workspaceRoot, rawPath)
  const relativePath = path.relative(workspaceRoot, absolutePath)
  return relativePath.length > 0 && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

const readOptionalPathArg = (
  args: Record<string, unknown>,
  key: string,
  options?: { required?: boolean },
): string | undefined => {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    if (options?.required) {
      throw new CliTaskValidationError(`Missing required path argument: ${key}`)
    }
    return undefined
  }
  const normalizedPath = value.trim()
  if (!isPathInsideWorkspace(normalizedPath)) {
    throw new CliTaskValidationError(`Path argument "${key}" must stay inside workspace: ${normalizedPath}`)
  }
  return normalizedPath
}

const readOptionalTextArg = (
  args: Record<string, unknown>,
  key: string,
  allowedValues?: string[],
): string | undefined => {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  const normalizedValue = value.trim()
  if (allowedValues && !allowedValues.includes(normalizedValue)) {
    throw new CliTaskValidationError(
      `Unsupported value for "${key}". Allowed: ${allowedValues.join(', ')}`,
    )
  }
  return normalizedValue
}

const readOptionalIntegerArg = (
  args: Record<string, unknown>,
  key: string,
  options: { min: number; max: number },
): number | undefined => {
  const value = args[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const integer = Math.floor(value)
  if (integer < options.min || integer > options.max) {
    throw new CliTaskValidationError(
      `Argument "${key}" must be between ${options.min} and ${options.max}.`,
    )
  }
  return integer
}

const buildCharacterImageScriptArgs = (args: Record<string, unknown>): string[] => {
  const commandArgs: string[] = []
  const characterPath = readOptionalPathArg(args, 'characterPath', { required: true })
  if (!characterPath) {
    throw new CliTaskValidationError('Missing required path argument: characterPath')
  }
  commandArgs.push('--character', characterPath)

  const styleReferencePath = readOptionalPathArg(args, 'styleReferencePath')
  if (styleReferencePath) {
    commandArgs.push('--style-reference', styleReferencePath)
  }

  const outputRoot = readOptionalPathArg(args, 'outputRoot')
  if (outputRoot) {
    commandArgs.push('--output-root', outputRoot)
  }

  const model = readOptionalTextArg(args, 'model', ['flux-2-pro-preview', 'flux-2-max', 'flux-2-flex'])
  if (model) {
    commandArgs.push('--model', model)
  }

  const heroModel = readOptionalTextArg(args, 'heroModel', [
    'flux-2-pro-preview',
    'flux-2-max',
    'flux-2-flex',
  ])
  if (heroModel) {
    commandArgs.push('--hero-model', heroModel)
  }

  const seed = readOptionalIntegerArg(args, 'seed', { min: 0, max: 2_147_483_647 })
  if (typeof seed === 'number') {
    commandArgs.push('--seed', String(seed))
  }

  const pollIntervalMs = readOptionalIntegerArg(args, 'pollIntervalMs', { min: 200, max: 10_000 })
  if (typeof pollIntervalMs === 'number') {
    commandArgs.push('--poll-interval-ms', String(pollIntervalMs))
  }

  const maxPollAttempts = readOptionalIntegerArg(args, 'maxPollAttempts', { min: 10, max: 300 })
  if (typeof maxPollAttempts === 'number') {
    commandArgs.push('--max-poll-attempts', String(maxPollAttempts))
  }

  const overwrite = args.overwrite === true
  if (overwrite) {
    commandArgs.push('--overwrite')
  }

  return commandArgs
}

const resolveTaskCommand = (input: RunCliTaskToolInput): ResolvedCommand => {
  const args = input.args ?? {}

  if (input.taskId === CLI_TASK_IDS.characterImagesDryRun) {
    const scriptArgs = buildCharacterImageScriptArgs(args)
    const commandArgs = ['run', 'character-images:dry-run', '--', ...scriptArgs]
    return {
      command: npmCommand,
      args: commandArgs,
      timeoutMs: 120_000,
      commandPreview: `${npmCommand} ${commandArgs.join(' ')}`,
    }
  }

  if (input.taskId === CLI_TASK_IDS.characterImagesGenerate) {
    const scriptArgs = buildCharacterImageScriptArgs(args)
    const commandArgs = ['run', 'character-images:generate', '--', ...scriptArgs]
    return {
      command: npmCommand,
      args: commandArgs,
      timeoutMs: 900_000,
      commandPreview: `${npmCommand} ${commandArgs.join(' ')}`,
    }
  }

  if (input.taskId === CLI_TASK_IDS.runtimeSmoke) {
    const mode = readOptionalTextArg(args, 'mode', ['smoke', 'visual', 'quiz', 'context', 'memory-image'])
    const baseUrl = readOptionalTextArg(args, 'baseUrl')
    const character = readOptionalTextArg(args, 'character')
    const commandArgs = ['run', 'runtime:smoke']
    const scriptArgs: string[] = []
    if (mode) scriptArgs.push(`--mode=${mode}`)
    if (baseUrl) scriptArgs.push(`--base-url=${baseUrl}`)
    if (character) scriptArgs.push(`--character=${character}`)
    if (scriptArgs.length > 0) {
      commandArgs.push('--', ...scriptArgs)
    }
    return {
      command: npmCommand,
      args: commandArgs,
      timeoutMs: 180_000,
      commandPreview: `${npmCommand} ${commandArgs.join(' ')}`,
    }
  }

  throw new CliTaskValidationError(`Unsupported cli task id: ${input.taskId}`)
}

const executeCommand = async (command: ResolvedCommand): Promise<RunCliTaskToolOutput> => {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    execFile(
      command.command,
      command.args,
      {
        cwd: workspaceRoot,
        timeout: command.timeoutMs,
        maxBuffer: outputMaxBufferBytes,
        env: process.env,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt
        if (!error) {
          resolve({
            ok: true,
            exitCode: 0,
            stdout,
            stderr,
            durationMs,
            commandPreview: command.commandPreview,
          })
          return
        }

        const rawCode = (error as NodeJS.ErrnoException & { code?: string | number }).code
        const errorCode = typeof rawCode === 'number' ? rawCode : 1
        resolve({
          ok: false,
          exitCode: errorCode,
          stdout,
          stderr: stderr || (error instanceof Error ? error.message : String(error)),
          durationMs,
          commandPreview: command.commandPreview,
        })
      },
    )
  })
}

export const runCliTaskTool: RuntimeToolHandler<RunCliTaskToolInput, RunCliTaskToolOutput> = {
  id: CHARACTER_AGENT_TOOLS.runCliTask,
  execute: async (context, input) => {
    await trackTraceActivitySafely({
      activityType: 'trace.tool.run_cli_task.request',
      summary: `${context.characterName} startet run_cli_task`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: 'request',
      traceSource: 'runtime',
      input,
    })
    const resolvedInput: RunCliTaskToolInput = {
      taskId: input.taskId,
      args: input.args ?? {},
      dryRun: input.dryRun === true,
    }

    let command: ResolvedCommand
    try {
      command = resolveTaskCommand(resolvedInput)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const validationResult: RunCliTaskToolOutput = {
        ok: false,
        exitCode: 1,
        stdout: '',
        stderr: message,
        durationMs: 0,
        commandPreview: 'validation-failed',
      }
      await trackRuntimeToolActivitySafely({
        activityType: 'tool.cli_task.validation_failed',
        characterId: context.characterId,
        characterName: context.characterName,
        conversationId: context.conversationId,
        learningGoalIds: context.learningGoalIds,
        object: {
          type: 'tool',
          id: CHARACTER_AGENT_TOOLS.runCliTask,
        },
        metadata: {
          summary: `${context.characterName} konnte den CLI-Task nicht validieren`,
          toolId: CHARACTER_AGENT_TOOLS.runCliTask,
          taskId: resolvedInput.taskId,
          reason: message,
        },
      })
      await trackTraceActivitySafely({
        activityType: 'trace.tool.run_cli_task.error',
        summary: `${context.characterName} konnte run_cli_task nicht validieren`,
        conversationId: context.conversationId,
        characterId: context.characterId,
        characterName: context.characterName,
        learningGoalIds: context.learningGoalIds,
        traceStage: 'tool',
        traceKind: 'error',
        traceSource: 'runtime',
        input: resolvedInput,
        ok: false,
        error: message,
      })
      return validationResult
    }

    await trackRuntimeToolActivitySafely({
      activityType: resolvedInput.dryRun ? 'tool.cli_task.previewed' : 'tool.cli_task.started',
      characterId: context.characterId,
      characterName: context.characterName,
      conversationId: context.conversationId,
      learningGoalIds: context.learningGoalIds,
      object: {
        type: 'tool',
        id: CHARACTER_AGENT_TOOLS.runCliTask,
      },
      metadata: {
        summary: resolvedInput.dryRun
          ? `${context.characterName} plant einen CLI-Task`
          : `${context.characterName} startet einen CLI-Task`,
        toolId: CHARACTER_AGENT_TOOLS.runCliTask,
        taskId: resolvedInput.taskId,
        commandPreview: command.commandPreview,
        dryRun: resolvedInput.dryRun,
      },
    })

    if (resolvedInput.dryRun) {
      return {
        ok: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 0,
        commandPreview: command.commandPreview,
      }
    }

    const result = await executeCommand(command)
    await trackRuntimeToolActivitySafely({
      activityType: result.ok ? 'tool.cli_task.completed' : 'tool.cli_task.failed',
      characterId: context.characterId,
      characterName: context.characterName,
      conversationId: context.conversationId,
      learningGoalIds: context.learningGoalIds,
      object: {
        type: 'tool',
        id: CHARACTER_AGENT_TOOLS.runCliTask,
      },
      metadata: {
        summary: result.ok
          ? `${context.characterName} hat einen CLI-Task abgeschlossen`
          : `${context.characterName} konnte den CLI-Task nicht abschliessen`,
        toolId: CHARACTER_AGENT_TOOLS.runCliTask,
        taskId: resolvedInput.taskId,
        commandPreview: command.commandPreview,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      },
    })

    await trackTraceActivitySafely({
      activityType: result.ok ? 'trace.tool.run_cli_task.response' : 'trace.tool.run_cli_task.error',
      summary: result.ok
        ? `${context.characterName} beendet run_cli_task`
        : `${context.characterName} run_cli_task fehlgeschlagen`,
      conversationId: context.conversationId,
      characterId: context.characterId,
      characterName: context.characterName,
      learningGoalIds: context.learningGoalIds,
      traceStage: 'tool',
      traceKind: result.ok ? 'response' : 'error',
      traceSource: 'runtime',
      output: {
        ok: result.ok,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        commandPreview: result.commandPreview,
      },
      ok: result.ok,
      error: result.ok ? undefined : result.stderr,
    })

    return result
  },
}
