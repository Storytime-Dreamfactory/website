import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { characterCreatorApiPlugin } from './tools/character-image-service/src/localApiPlugin.ts'
import { realtimeApiPlugin } from './src/server/realtimePlugin.ts'
import { relationshipsApiPlugin } from './src/server/relationshipsPlugin.ts'
import { conversationsApiPlugin } from './src/server/conversationsPlugin.ts'
import { activitiesApiPlugin } from './src/server/activitiesPlugin.ts'
import { imageGenerationApiPlugin } from './src/server/imageGenerationPlugin.ts'
import { conversationImageToolApiPlugin } from './src/server/conversationImageToolPlugin.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  return {
    plugins: [
      react(),
      characterCreatorApiPlugin(),
      realtimeApiPlugin(),
      relationshipsApiPlugin(),
      conversationsApiPlugin(),
      activitiesApiPlugin(),
      imageGenerationApiPlugin(),
      conversationImageToolApiPlugin(),
    ],
    server: {
      proxy: {
        '/__debug_ingest': {
          target: 'http://127.0.0.1:7409',
          changeOrigin: true,
        },
      },
    },
  }
})
