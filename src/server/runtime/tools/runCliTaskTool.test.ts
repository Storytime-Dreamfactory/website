import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'

const mocks = vi.hoisted(() => ({
  createActivityMock: vi.fn(),
  execFileMock: vi.fn(),
}))

vi.mock('../../activityStore.ts', () => ({
  createActivity: mocks.createActivityMock,
}))

vi.mock('node:child_process', () => ({
  execFile: mocks.execFileMock,
}))

import { CLI_TASK_IDS, runCliTaskTool } from './runCliTaskTool.ts'

describe('runCliTaskTool', () => {
  type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createActivityMock.mockResolvedValue(undefined)
    mocks.execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: ExecFileOptionsWithStringEncoding,
        callback: ExecCallback,
      ) => {
      callback(null, 'ok', '')
      },
    )
  })

  it('liefert bei dryRun nur commandPreview ohne Prozessstart', async () => {
    const result = await runCliTaskTool.execute(
      {
        conversationId: 'conv-1',
        characterId: 'yoko',
        characterName: 'Yoko',
      },
      {
        taskId: CLI_TASK_IDS.characterImagesDryRun,
        dryRun: true,
        args: {
          characterPath: 'content/characters/yoko/character.yaml',
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.commandPreview).toContain('character-images:dry-run')
    expect(mocks.execFileMock).not.toHaveBeenCalled()
  })

  it('blockt Pfade ausserhalb des Workspaces', async () => {
    const result = await runCliTaskTool.execute(
      {
        conversationId: 'conv-1',
        characterId: 'yoko',
        characterName: 'Yoko',
      },
      {
        taskId: CLI_TASK_IDS.characterImagesGenerate,
        args: {
          characterPath: '../secrets/character.yaml',
        },
      },
    )

    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('workspace')
    expect(mocks.execFileMock).not.toHaveBeenCalled()
  })

  it('fuehrt erlaubte Tasks aus und gibt stdout/stderr zurueck', async () => {
    mocks.execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: ExecFileOptionsWithStringEncoding,
        callback: ExecCallback,
      ) => {
        callback(null, 'generation complete', '')
      },
    )

    const result = await runCliTaskTool.execute(
      {
        conversationId: 'conv-2',
        characterId: 'nola',
        characterName: 'Nola',
      },
      {
        taskId: CLI_TASK_IDS.characterImagesGenerate,
        args: {
          characterPath: 'content/characters/nola/character.yaml',
          seed: 4242,
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('generation complete')
    expect(mocks.execFileMock).toHaveBeenCalledTimes(1)
  })
})
