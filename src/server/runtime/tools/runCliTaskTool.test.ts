import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecFileOptionsWithStringEncoding } from 'node:child_process'

const mocks = vi.hoisted(() => ({
  createActivityMock: vi.fn(),
  execFileMock: vi.fn(),
  getGameObjectMock: vi.fn(),
}))

vi.mock('../../activityStore.ts', () => ({
  createActivity: mocks.createActivityMock,
}))

vi.mock('node:child_process', () => ({
  execFile: mocks.execFileMock,
}))

vi.mock('../../gameObjectService.ts', () => ({
  get: mocks.getGameObjectMock,
}))

import { CLI_TASK_IDS, runCliTaskTool } from './runCliTaskTool.ts'

describe('runCliTaskTool', () => {
  type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createActivityMock.mockResolvedValue(undefined)
    mocks.getGameObjectMock.mockResolvedValue(null)
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
        characterId: '00000000-0000-4000-8000-000000000001',
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
        characterId: '00000000-0000-4000-8000-000000000001',
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
        characterId: '8eb40291-65ee-49b6-b826-d7c7e97404c0',
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

  it('nutzt characterId aus Context wenn characterPath fehlt', async () => {
    mocks.getGameObjectMock.mockResolvedValue({
      id: '00000000-0000-4000-8000-000000000001',
      type: 'character',
      slug: 'yoko',
      name: 'Yoko',
    })

    const result = await runCliTaskTool.execute(
      {
        conversationId: 'conv-3',
        characterId: '00000000-0000-4000-8000-000000000001',
        characterName: 'Yoko',
      },
      {
        taskId: CLI_TASK_IDS.characterImagesGenerate,
        args: {
          seed: 1234,
        },
      },
    )

    expect(result.ok).toBe(true)
    expect(result.commandPreview).toContain('--character content/characters/yoko/character.yaml')
    expect(mocks.execFileMock).toHaveBeenCalledTimes(1)
  })
})
