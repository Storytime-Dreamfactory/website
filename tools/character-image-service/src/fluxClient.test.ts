import { afterEach, describe, expect, it, vi } from 'vitest'
import { FluxClient } from './fluxClient.ts'

describe('FluxClient.pollResult', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('liefert bei Timeout erweiterte Polling-Diagnostik', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'Processing' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new FluxClient('test-key')
    await expect(
      client.pollResult({
        pollingUrl: 'https://api.bfl.ai/v1/get_result?id=req-123',
        pollIntervalMs: 1,
        maxAttempts: 2,
      }),
    ).rejects.toThrow(
      'FLUX polling timed out after 2 attempts; pollingUrl=https://api.bfl.ai/v1/get_result?id=req-123, attempt=2/2, pollIntervalMs=1, lastStatus=Processing',
    )
  })
})
