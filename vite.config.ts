import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { characterCreatorApiPlugin } from './tools/character-image-service/src/localApiPlugin.ts'
import { realtimeApiPlugin } from './src/server/realtimePlugin.ts'
import { relationshipsApiPlugin } from './src/server/relationshipsPlugin.ts'
import { conversationsApiPlugin } from './src/server/conversationsPlugin.ts'
import { activitiesApiPlugin } from './src/server/activitiesPlugin.ts'
import { imageGenerationApiPlugin } from './src/server/imageGenerationPlugin.ts'
import { conversationImageToolApiPlugin } from './src/server/conversationImageToolPlugin.ts'
import { conversationQuizToolApiPlugin } from './src/server/conversationQuizToolPlugin.ts'
import { contentYamlPlugin } from './src/server/contentYamlPlugin.ts'
import { gameObjectsApiPlugin } from './src/server/gameObjectsPlugin.ts'
import { evalProcessorPlugin } from './src/server/evalProcessorPlugin.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // In local dev we want deterministic env resolution from .env files.
  // This prevents stale shell exports from shadowing project config.
  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value
  }

  const useRemoteApis = env.STORYTIME_USE_REMOTE_APIS === 'true'
  const remoteApiOrigin =
    env.STORYTIME_REMOTE_API_ORIGIN ??
    'https://da64uvv5aj.execute-api.eu-central-1.amazonaws.com'
  const remoteContentOrigin =
    env.STORYTIME_REMOTE_CONTENT_ORIGIN ??
    'https://d3fanezyptletr.cloudfront.net'

  const plugins = [
    react(),
    ...(useRemoteApis ? [] : [contentYamlPlugin()]),
    ...(useRemoteApis
      ? []
      : [
          characterCreatorApiPlugin(),
          realtimeApiPlugin(),
          gameObjectsApiPlugin(),
          relationshipsApiPlugin(),
          conversationsApiPlugin(),
          activitiesApiPlugin(),
          imageGenerationApiPlugin(),
          conversationImageToolApiPlugin(),
          conversationQuizToolApiPlugin(),
          evalProcessorPlugin(),
        ]),
  ]

  return {
    plugins,
    define: {
      __STORYTIME_USE_REMOTE_APIS__: JSON.stringify(useRemoteApis),
      __STORYTIME_REMOTE_API_ORIGIN__: JSON.stringify(remoteApiOrigin),
      __STORYTIME_REMOTE_CONTENT_ORIGIN__: JSON.stringify(remoteContentOrigin),
    },
    server: {
      proxy: {
        '/__debug_ingest': {
          target: 'http://127.0.0.1:7409',
          changeOrigin: true,
        },
        ...(useRemoteApis
          ? {
              '/api': {
                target: remoteApiOrigin,
                changeOrigin: true,
              },
              '/health': {
                target: remoteApiOrigin,
                changeOrigin: true,
              },
              '/ready': {
                target: remoteApiOrigin,
                changeOrigin: true,
              },
              '/content': {
                target: remoteContentOrigin,
                changeOrigin: true,
              },
              '/content-manifest.json': {
                target: remoteContentOrigin,
                changeOrigin: true,
              },
            }
          : {}),
      },
    },
  }
})
