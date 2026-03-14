# Storytime Website

Storytime ist eine React- und TypeScript-App mit **YAML-first Content-System**.
Characters, Places und Lernziele werden als YAML gepflegt und von der App geladen.

Begriffslogik:
- `Lernziele` sind fachliche Inhaltsobjekte.
- `Skills` sind agentische Playbooks wie Quiz oder visuell ausdruecken.
- `Tools` sind konkrete Runtime-Aktionen wie Bild generieren, Bild wieder anzeigen oder Kontext lesen.

## Start hier

- App-Einstieg: `src/App.tsx`
- Content-Loader: `src/content/loaders.ts`
- Content-Modelle: `src/content/types.ts`
- Content-Regeln: `docs/content-model.md`
- Agent-Workflow: `docs/agent-guide.md`
- Deploy-Workflow: `docs/deploy-workflow.md`
- Repo-Agent-Regeln: `AGENTS.md`
- Visuelle Stilregeln: `docs/visual-style-guide.md`
- Character Generator: `tools/character-image-service/README.md`
- Artifact Generator: `tools/artifact-image-service/README.md`

## Projektstruktur

- `content/`  
  Build-Time-Fallback-Inhalte (werden gebundelt und funktionieren auch ohne Runtime-Quelle)
- `public/content/`  
  Runtime-Inhalte (werden im Browser per `fetch` geladen)
- `public/content-manifest.json`  
  Liste der YAML-Dateien, die zur Laufzeit geladen werden
- `src/content/`  
  Typen, Validierung und Lade-Logik

## Entwicklung

```bash
npm install
npm run dev
```

### Lokal gegen echte APIs arbeiten (optional)

Standardmaessig nutzt `npm run dev` lokale Vite-API-Plugins.
Wenn du stattdessen lokal gegen die produktive AWS-API arbeiten willst:

1. `.env.example` nach `.env` kopieren (falls noch nicht passiert)
2. In `.env` setzen:

```bash
STORYTIME_USE_REMOTE_APIS=true
STORYTIME_REMOTE_API_ORIGIN=https://da64uvv5aj.execute-api.eu-central-1.amazonaws.com
```

Dann proxyt Vite lokal folgende Routen auf die echte API:

- `/api/*`
- `/health`
- `/ready`

Wichtig: Das betrifft nur den lokalen Dev-Server. Das Production-Routing bleibt in `vercel.json`.

### Empfohlener Workflow (Local -> GitHub -> Vercel)

1. Lokal entwickeln und testen (`npm run dev`, `npm run quality:local`)
2. Aenderungen committen und nach GitHub pushen
3. Vercel baut und deployt automatisch den aktuellen Branch/PR
4. Nach Merge auf den Hauptbranch laeuft der Production-Deploy
5. Nach Production-Deploy Smoke-Check ausfuehren (`npm run deploy:smoke -- https://<deine-vercel-domain>`, optional `200,401` bei geschuetzter Preview)

## Build und Qualität

```bash
npm run lint
npm run build
```

## Character Relationships (Postgres)

Zum Speichern von Beziehungen zwischen Figuren gibt es eine Postgres-Integration.
Das funktioniert lokal und spaeter identisch auf AWS Postgres (RDS/Aurora) ueber `DATABASE_URL`.

Lokale DB starten:

```bash
npm run db:start
```

Schema initialisieren:

```bash
npm run db:init-relationships
```

Umgebungsvariablen:

- `DATABASE_URL` (z. B. `postgres://storytime:storytime@localhost:5433/storytime`)
- `BFL_API_KEY` fuer FLUX-Bildmodelle
- `GOOGLE_GEMINI_API_KEY` fuer Gemini-Bildmodelle wie `gemini-3.1-flash-image`
- `OPENAI_API_KEY` fuer OpenAI-Bildmodelle wie `gpt-image-1.5` oder `chatgpt-image-latest`
- `CONVERSATION_IMAGE_MODEL` optional fuer das Standardmodell der Conversation-Hero-Bildgenerierung, z. B. `mini` (`flux-2-klein-4b`), `flux-2-pro`, `banana` (`gemini-2.5-flash-image`) oder `chatgpt` (`chatgpt-image-latest`). Default: `flux-2-pro`
- `AWS_REGION` und `ACTIVITY_EVENTBRIDGE_*` optional fuer Activity-Dual-Write nach AWS EventBridge

API-Endpunkte (lokaler Vite-Server):

- `POST /api/relationships/`
  - Body: `sourceCharacterId`, `targetCharacterId`, `relationshipType` (vordefiniert), optional `fromTitle`, optional `toTitle`, optional `relationship`, optional `description`, optional `properties` (JSON oder YAML-String), optional `otherRelatedObjects`
- `GET /api/relationships/?characterId=<id>`
  - Liefert eingehende und ausgehende Beziehungen für eine Figur
- `GET /api/relationships/all`
  - Liefert alle Character-Beziehungen (wird vom Frontend-Loader genutzt)
- `GET /api/relationships/types`
  - Liefert die erlaubten Relationship-Typen inkl. `fromTitle`/`toTitle`
- `POST /api/activities/`
  - Legt einen Activity-Stream-Eintrag an
  - Body: `activityType`, optional `isPublic` (default `false`), optional `characterId`, optional `placeId`, optional `learningGoalIds[]`, optional `conversationId`, optional `subject`, optional `object`, optional `metadata`, optional `occurredAt`
- `GET /api/activities/?characterId=<id>&placeId=<id>&learningGoalId=<id>&conversationId=<id>&activityType=<type>&limit=100&offset=0`
  - Listet standardmaessig nur `isPublic=true` Activities, optional gefiltert nach Character, Place, Lernziel, Conversation und Type
  - Mit `includeNonPublic=true` werden auch interne/non-consumer-facing Activities geliefert
  - Sortierung: neueste zuerst (`occurredAt DESC`)
- `GET /api/activities/stream?characterId=<id>&placeId=<id>&learningGoalId=<id>&conversationId=<id>&activityType=<type>`
  - Server-Sent-Events (SSE) Stream fuer Live-Updates aus der DB (Postgres `LISTEN/NOTIFY`)
  - Nutzt dieselben Filter; standardmaessig nur `isPublic=true`, mit `includeNonPublic=true` auch interne Events
- `POST /api/images/generate`
  - Schneller Prompt-zu-Bild Endpoint fuer Chat-Workflows
  - Body: `prompt` (required), optional `model` (z. B. `mini`, `banana`, `chatgpt`, `openai`, `flux-2-klein-4b`, `flux-2-max`, `gemini-3.1-flash-image`, `gpt-image-1.5`, `chatgpt-image-latest`; Default `flux-2-flex`), `width`, `height`, `outputFormat` (`jpeg` oder `png`), `seed`, `pollIntervalMs`, `maxPollAttempts`
  - Response: `imageUrl`, `requestId`, aufgeloeste Parameter und optionale `cost`

## Conversation-End Webhook

Wenn eine Conversation per `POST /api/conversations/end` beendet wird, kann optional
ein externer Service aufgerufen werden (Best-Effort).

Umgebungsvariablen:

- `CONVERSATION_END_WEBHOOK_URL` (optional)
- `CONVERSATION_END_WEBHOOK_SECRET` (optional, wird als `X-Conversation-Webhook-Secret` Header gesendet)
- `CONVERSATION_END_WEBHOOK_TIMEOUT_MS` (optional, Default: `4000`)

Hinweis:

- Beim Conversation-Flow werden zusaetzlich Activities automatisch erfasst:
  - `conversation.started` (`isPublic=false`)
  - `conversation.message.created` (`isPublic=false`)
  - `conversation.ended` (`isPublic=false`)
  - `character.chat.completed` (`isPublic=true`, derzeit mit hart codierter Person `Yoko` und Label `Check here`)
- Place-/Lernziel-Kontext kann ueber Conversation-Metadata mitgegeben werden:
  - `placeId` oder `place_id`
  - `learningGoalIds` / `learning_goal_ids` (Array) oder `learningGoalId` (single)

## Activity EventBridge (Dual-Write)

Activities bleiben weiterhin in Postgres (`character_activities`) als Query-/History-Store.
Optional kann bei jedem `createActivity` zusaetzlich ein Event nach AWS EventBridge publiziert werden.

Umgebungsvariablen:

- `ACTIVITY_EVENTBRIDGE_ENABLED` (`true`/`false`, default `false`)
- `AWS_REGION` (z. B. `eu-central-1`)
- `ACTIVITY_EVENTBRIDGE_BUS_NAME` (Name oder ARN des Event Busses)
- `ACTIVITY_EVENTBRIDGE_SOURCE` (default `storytime.activities`)
- `ACTIVITY_EVENTBRIDGE_DETAIL_TYPE_PREFIX` (default `storytime.activity`)
- `ACTIVITY_EVENTBRIDGE_STRICT` (`true` => Publish-Fehler brechen den Request ab; default `false`)
- `ACTIVITY_EVENTBRIDGE_ENDPOINT` optional (z. B. LocalStack)

CLI-Query:

```bash
npm run db:query-relationships -- finja-schneevoegelchen
```

## Character-Bilder generieren

```bash
npm run character-images:dry-run -- --character ./content/characters/nola.yaml --style-reference /absolute/path/to/reference.png
npm run character-images:generate -- --character ./content/characters/nola.yaml --style-reference /absolute/path/to/reference.png
```

- API-Key nur ueber `BFL_API_KEY`
- Fuer API-basierte Gemini-Bildgenerierung zusaetzlich `GOOGLE_GEMINI_API_KEY`
- Fuer OpenAI-Bildgenerierung zusaetzlich `OPENAI_API_KEY`
- Outputs landen unter `public/content/characters/<id>/`
- Stil- und Prompting-Regeln stehen in `docs/visual-style-guide.md`, `AGENTS.md` und `content/prompts/README.md`

## Artifact-Bilder aus Manifest generieren

```bash
npm run artifact-images:dry-run
npm run artifact-images:generate
```

- Quelle ist `public/content-manifest.json` -> `artifacts[]`
- Pro Artifact werden genau drei Zielbilder aus dem YAML erzeugt:
  - `images.standard_artifact.file`
  - `images.hero_image.file`
  - `images.portrait.file`
- Outputs landen unter `public/content/artifacts/<uuid>/`
- API-Key nur ueber `BFL_API_KEY` (optional auch `GOOGLE_GEMINI_API_KEY`/`OPENAI_API_KEY`, je nach Modell in `src/server/imageModelSupport.ts`)

## Neue Figur hinzufügen (Quick Guide)

1. Neue Datei in `content/characters/` anlegen, z. B. `luna.yaml`.
2. Gleiche Datei nach `public/content/characters/` spiegeln.
3. Pfad in `public/content-manifest.json` unter `characters` eintragen.
4. Felder gemaess `docs/content-model.md` pruefen.
5. Falls Bilder benoetigt werden, den Character Image Service ausfuehren.
6. `npm run lint && npm run build` ausfuehren.
