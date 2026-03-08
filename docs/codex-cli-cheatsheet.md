# Codex CLI Cheat Sheet

Praktische Referenz fuer die Nutzung von Codex im Storytime-Repo, mit Fokus auf Activities, Conversations, YAML-Content und Character-Relationships.

## 1. Setup

```bash
npm install
npm run db:start
npm run dev
```

Optionale DB-Initialisierung:

```bash
npm run db:init-relationships
```

Wichtige Umgebungsvariablen:

- `DATABASE_URL` (Default lokal: `postgres://storytime:storytime@localhost:5433/storytime`)
- `BFL_API_KEY` (nur fuer Character-Bildgenerierung)

## 2. Relationships

### 2.1 Relationship-DB initialisieren

```bash
npm run db:init-relationships
```

### 2.2 Beziehungen eines Characters abfragen

```bash
npm run db:query-relationships -- finja-schneevoegelchen
```

### 2.3 Beziehung per API anlegen/aktualisieren

```bash
curl -X POST http://localhost:5173/api/relationships/ \
  -H "Content-Type: application/json" \
  -d '{
    "sourceCharacterId":"nola",
    "targetCharacterId":"romi",
    "relationshipType":"freundschaft",
    "relationshipTypeReadable":"Freundschaft",
    "relationship":"Freundin",
    "description":"Gehen oft gemeinsam auf Entdeckung."
  }'
```

Alle Beziehungen:

```bash
curl "http://localhost:5173/api/relationships/all"
```

Beziehungen fuer einen Character:

```bash
curl "http://localhost:5173/api/relationships/?characterId=nola"
```

Relationship-Wissen inkl. related objects:

```bash
curl "http://localhost:5173/api/relationships/knowledge?characterId=nola"
```

## 3. Conversations

### 3.1 Conversation starten

```bash
curl -X POST http://localhost:5173/api/conversations/start \
  -H "Content-Type: application/json" \
  -d '{
    "characterId":"nola",
    "userId":"demo-user",
    "metadata":{"placeId":"crystal-lake","learningGoalIds":["kindness"]}
  }'
```

### 3.2 Message anhaengen

```bash
curl -X POST http://localhost:5173/api/conversations/message \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId":"<UUID>",
    "role":"user",
    "content":"Hallo Nola!",
    "eventType":"chat.turn"
  }'
```

### 3.3 Conversation beenden

```bash
curl -X POST http://localhost:5173/api/conversations/end \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId":"<UUID>",
    "metadata":{"mood":"happy-end"}
  }'
```

### 3.4 Conversation-Details holen

```bash
curl "http://localhost:5173/api/conversations/?conversationId=<UUID>"
```

### 3.5 Frueheres Conversation-Bild erneut anzeigen (ohne Neugenerierung)

```bash
curl -X POST http://localhost:5173/api/tools/display-existing-image \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId":"<UUID>",
    "queryText":"Zeig nochmal das Bild vom Strand"
  }'
```

Hinweis: Der Conversation-Flow erzeugt automatisch Activities wie `conversation.started`, `conversation.message.created`, `conversation.ended` und `character.chat.completed`.
Bild-Events speichern Runtime-Assets zusaetzlich lokal unter `public/content/conversations/<conversationId>/`.

## 4. Activities

### 4.1 Activity erstellen

```bash
curl -X POST http://localhost:5173/api/activities/ \
  -H "Content-Type: application/json" \
  -d '{
    "activityType":"character.chat.completed",
    "isPublic":true,
    "characterId":"nola",
    "placeId":"crystal-lake",
    "learningGoalIds":["kindness"],
    "metadata":{"summary":"Nola chatted with Yoko"}
  }'
```

### 4.2 Activities filtern

```bash
curl "http://localhost:5173/api/activities/?characterId=nola&limit=20"
```

Auch nicht-oeffentliche Events:

```bash
curl "http://localhost:5173/api/activities/?includeNonPublic=true&conversationId=<UUID>"
```

### 4.3 Live-Stream (SSE)

```bash
curl -N "http://localhost:5173/api/activities/stream?characterId=nola"
```

## 5. YAML-Workflow

Wenn Content geaendert wird (Characters, Places, Lernziele, Prompts), immer:

1. Datei in `content/...` pflegen.
2. Dieselbe Datei nach `public/content/...` spiegeln.
3. `public/content-manifest.json` aktualisieren.
4. Qualitaetschecks laufen lassen:

```bash
npm run lint
npm run build
```

### Character-Bilder via CLI

Dry Run:

```bash
npm run character-images:dry-run -- --character ./content/characters/nola/character.yaml --style-reference /ABS/PFAD/ref.png
```

Generierung:

```bash
npm run character-images:generate -- --character ./content/characters/nola/character.yaml --style-reference /ABS/PFAD/ref.png --overwrite
```

## 6. Runtime-Smoke-Tests fuer Conversation-Flows

Damit Character-Runtime, Skill-Routing, Tool-Aufrufe und Activity-Logging schnell pruefbar sind:

```bash
npm run runtime:smoke
```

Optionen:

```bash
# Nur Visual-Flow testen
npm run runtime:smoke -- --mode=visual --character=yoko --learning-goals=kindness

# Quiz-Flow
npm run runtime:smoke -- --mode=quiz

# Kontext-Flow (Relationships + Activities)
npm run runtime:smoke -- --mode=context --character=nola

# Erinnerungs-Flow: altes Bild wieder anzeigen
npm run runtime:smoke -- --mode=memory-image --character=yoko
```

Weitere Argumente:

- `--base-url=http://localhost:5173`
- `--place=crystal-lake`
- `--user-id=demo-user`
- `--learning-goals=kindness,problem-solving`

## 7. Codex-Prompt-Vorlagen

### Relationships per API pflegen

```text
Lies docs/content-model.md und AGENTS.md. Lege oder aktualisiere die Beziehung zwischen zwei Characters direkt ueber POST /api/relationships und pruefe das Ergebnis mit GET /api/relationships/?characterId=<id>.
```

### Conversation-Ende-zu-Ende testen

```text
Starte db und dev server, fuehre einen vollstaendigen Conversation-Flow per curl aus (start -> message -> end) und gib die wichtigsten Response-Felder kompakt aus.
```

### Activities debuggen

```text
Untersuche, warum activityType=character.chat.completed nicht im Public Feed erscheint. Pruefe isPublic, Filter und /api/activities, behebe den Fehler und teste mit curl.
```
