# Agent Guide

Diese Anleitung hilft KI-Agents, Content konsistent zu lesen und zu erweitern.

## Arbeitsweise

1. Zuerst `docs/content-model.md` lesen.
2. Bei neuen Inhalten immer beide Quellen aktualisieren:
   - `content/...` (Build-Time-Fallback)
   - `public/content/...` (Runtime-Quelle)
3. Danach `public/content-manifest.json` anpassen.
4. Abschliessend `npm run lint` und `npm run build` ausfuehren.

## Bearbeitungsregeln

- Keine bestehenden Felder umbenennen, ohne Loader/Typen anzupassen.
- Keine stillen Schema-Erweiterungen ohne Doku-Update.
- Bei Fehlern klare Validierungsnachricht hinterlegen (welche Datei/Feld fehlt).
- Beispielinhalte kurz und kindgerecht halten.

## Typische Tasks

- **Neuen Character hinzufuegen**  
  YAML in `content/characters/` + `public/content/characters/` anlegen, Manifest ergaenzen.

- **Skill-Quiz erweitern**  
  `quiz_examples` in beiden Skill-Dateien pflegen, dann UI pruefen.

- **Place korrigieren**  
  Beschreibung in beiden Place-Dateien angleichen, Build pruefen.

## Wichtige Dateien

- `src/content/types.ts`
- `src/content/validators.ts`
- `src/content/loaders.ts`
- `src/App.tsx`
