# Storytime Website

Storytime ist eine React- und TypeScript-App mit **YAML-first Content-System**.
Characters, Places und Skills werden als YAML gepflegt und von der App geladen.

## Start hier

- App-Einstieg: `src/App.tsx`
- Content-Loader: `src/content/loaders.ts`
- Content-Modelle: `src/content/types.ts`
- Content-Regeln: `docs/content-model.md`
- Agent-Workflow: `docs/agent-guide.md`
- Repo-Agent-Regeln: `AGENTS.md`
- Visuelle Stilregeln: `docs/visual-style-guide.md`
- Character Generator: `tools/character-image-service/README.md`

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

API-Endpunkte (lokaler Vite-Server):

- `POST /api/relationships/`
  - Body: `sourceCharacterId`, `targetCharacterId`, `relationship`, `relationshipType`, optional `relationshipTypeReadable`, optional `description`, optional `metadata`
- `GET /api/relationships/?characterId=<id>`
  - Liefert eingehende und ausgehende Beziehungen für eine Figur
- `GET /api/relationships/all`
  - Liefert alle Character-Beziehungen (wird vom Frontend-Loader genutzt)
- `POST /api/activities/`
  - Legt einen Activity-Stream-Eintrag an
  - Body: `activityType`, optional `isPublic` (default `false`), optional `characterId`, optional `placeId`, optional `skillIds[]`, optional `conversationId`, optional `subject`, optional `object`, optional `metadata`, optional `occurredAt`
- `GET /api/activities/?characterId=<id>&placeId=<id>&skillId=<id>&conversationId=<id>&activityType=<type>&limit=100&offset=0`
  - Listet standardmaessig nur `isPublic=true` Activities, optional gefiltert nach Character, Place, Skill, Conversation und Type
  - Mit `includeNonPublic=true` werden auch interne/non-consumer-facing Activities geliefert
  - Sortierung: neueste zuerst (`occurredAt DESC`)
- `POST /api/images/generate`
  - Schneller Prompt-zu-Bild Endpoint fuer Chat-Workflows
  - Body: `prompt` (required), optional `model` (Default `flux-2-flex`), `width`, `height`, `outputFormat` (`jpeg` oder `png`), `seed`, `pollIntervalMs`, `maxPollAttempts`
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
- Place/Skill-Kontext kann ueber Conversation-Metadata mitgegeben werden:
  - `placeId` oder `place_id`
  - `skillIds` / `skill_ids` (Array) oder `skillId` (single)

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
- Outputs landen unter `public/content/characters/<id>/`
- Stil- und Prompting-Regeln stehen in `docs/visual-style-guide.md`, `AGENTS.md` und `content/prompts/README.md`

## Neue Figur hinzufügen (Quick Guide)

1. Neue Datei in `content/characters/` anlegen, z. B. `luna.yaml`.
2. Gleiche Datei nach `public/content/characters/` spiegeln.
3. Pfad in `public/content-manifest.json` unter `characters` eintragen.
4. Felder gemaess `docs/content-model.md` pruefen.
5. Falls Bilder benoetigt werden, den Character Image Service ausfuehren.
6. `npm run lint && npm run build` ausfuehren.
