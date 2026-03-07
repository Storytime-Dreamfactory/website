# Storytime Website

Storytime ist eine React- und TypeScript-App mit **YAML-first Content-System**.
Characters, Places und Skills werden als YAML gepflegt und von der App geladen.

## Start hier

- App-Einstieg: `src/App.tsx`
- Content-Loader: `src/content/loaders.ts`
- Content-Modelle: `src/content/types.ts`
- Content-Regeln: `docs/content-model.md`
- Agent-Workflow: `docs/agent-guide.md`

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

## Neue Figur hinzufügen (Quick Guide)

1. Neue Datei in `content/characters/` anlegen, z. B. `luna.yaml`.
2. Gleiche Datei nach `public/content/characters/` spiegeln.
3. Pfad in `public/content-manifest.json` unter `characters` eintragen.
4. Felder gemäß `docs/content-model.md` prüfen.
5. `npm run lint && npm run build` ausführen.
