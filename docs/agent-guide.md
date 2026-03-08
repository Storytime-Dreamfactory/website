# Agent Guide

Diese Anleitung hilft KI-Agents, Content konsistent zu lesen und zu erweitern.

## Arbeitsweise

1. Zuerst `docs/content-model.md` lesen.
2. Bei Character-Bildern zusaetzlich `docs/visual-style-guide.md` und `AGENTS.md` lesen.
3. Bei neuen Inhalten immer beide Quellen aktualisieren:
   - `content/...` (Build-Time-Fallback)
   - `public/content/...` (Runtime-Quelle)
4. Danach `public/content-manifest.json` anpassen.
5. Fuer Character-Assets die Generator-CLI unter `tools/character-image-service/` verwenden.
6. Abschliessend `npm run lint` und `npm run build` ausfuehren.

## Bearbeitungsregeln

- Keine bestehenden Felder umbenennen, ohne Loader/Typen anzupassen.
- Keine stillen Schema-Erweiterungen ohne Doku-Update.
- Bei Fehlern klare Validierungsnachricht hinterlegen (welche Datei/Feld fehlt).
- Beispielinhalte kurz und kindgerecht halten.
- Keine direkten IP- oder Franchise-Nennungen in Stil- oder Bildprompts verwenden.

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
