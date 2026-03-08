import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import {
  showImageToolApi,
  runLearningGoalQuizToolApi,
} from './runtime/tools/toolApiService.ts'

type MiddlewareStack = {
  use: (
    route: string,
    handler: (
      request: IncomingMessage,
      response: ServerResponse,
      next: (error?: unknown) => void,
    ) => void | Promise<void>,
  ) => void
}

const json = (response: ServerResponse, statusCode: number, data: unknown): void => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(data))
}

const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
}

const readText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const registerConversationQuizToolApi = (middlewares: MiddlewareStack): void => {
  middlewares.use('/api/tools', async (request, response, next) => {
    try {
      const requestUrl = new URL(request.url ?? '', 'http://localhost')
      if (request.method !== 'POST') {
        next()
        return
      }

      if (requestUrl.pathname === '/run-learning-goal-quiz') {
        const body = await readJsonBody(request)
        const result = await runLearningGoalQuizToolApi({
          conversationId: readText(body.conversationId),
          learningGoalId: readText(body.learningGoalId) || undefined,
          userText: readText(body.userText) || undefined,
          assistantText: readText(body.assistantText) || undefined,
        })
        if (!result) {
          json(response, 400, {
            error:
              'Quiz konnte nicht gestartet werden. Bitte pruefe conversationId und aktives Lernziel.',
          })
          return
        }
        json(response, 200, { quiz: result })
        return
      }

      // Legacy alias bleibt vorerst aktiv, primärer Tool-Pfad ist /show-image.
      if (requestUrl.pathname === '/show-image' || requestUrl.pathname === '/display-existing-image') {
        const body = await readJsonBody(request)
        const conversationId = readText(body.conversationId)
        const queryText = readText(body.queryText) || undefined
        // #region agent log
        fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H1',location:'conversationQuizToolPlugin.ts:/show-image:request',message:'API-Aufruf show-image eingegangen',data:{conversationId,hasQueryText:Boolean(queryText)},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
        const image = await showImageToolApi({
          conversationId,
          queryText,
        })
        if (!image) {
          // #region agent log
          fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H3',location:'conversationQuizToolPlugin.ts:/show-image:not-found',message:'show-image liefert kein Bild',data:{conversationId},timestamp:Date.now()})}).catch(()=>{})
          // #endregion
          json(response, 404, {
            error:
              'Kein frueheres Conversation-Bild gefunden. Bitte zuerst ein Bild erzeugen oder anzeigen.',
          })
          return
        }
        // #region agent log
        fetch('http://127.0.0.1:7409/ingest/c7f5298f-6222-4a70-b3da-ad14507ad4e6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'1ef0fd'},body:JSON.stringify({sessionId:'1ef0fd',runId:'initial',hypothesisId:'H4',location:'conversationQuizToolPlugin.ts:/show-image:ok',message:'show-image liefert Bild',data:{conversationId,reason:image.reason,imageUrl:image.imageUrl},timestamp:Date.now()})}).catch(()=>{})
        // #endregion
        json(response, 200, { image })
        return
      }

      next()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode =
        message.includes('erforderlich') || message.includes('nicht gefunden') ? 400 : 500
      json(response, statusCode, { error: message })
    }
  })
}

export const conversationQuizToolApiPlugin = (): Plugin => ({
  name: 'storytime-conversation-quiz-tool-api',
  configureServer(server) {
    registerConversationQuizToolApi(server.middlewares)
  },
  configurePreviewServer(server) {
    registerConversationQuizToolApi(server.middlewares)
  },
})
