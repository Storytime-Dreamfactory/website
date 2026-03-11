import type { Plugin } from 'vite'
import { initEvalProcessor } from './evalProcessor.ts'

export const evalProcessorPlugin = (): Plugin => ({
  name: 'storytime-eval-processor',
  configureServer() {
    void initEvalProcessor().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[eval-processor] Init failed: ${message}`)
    })
  },
})
