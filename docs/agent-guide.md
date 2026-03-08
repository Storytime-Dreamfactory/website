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
- Character-Relationships nie in YAML pflegen; ausschliesslich die Relationship-DB/API verwenden.

## Runtime-Routing-Regeln

- Skill- und Tool-Entscheidungen sind LLM-basiert und folgen strukturierten Modell-Outputs.
- Regex-/Keyword-Matching darf nicht als produktive Entscheidungsgrundlage fuer Runtime-Routing verwendet werden.
- Parser/Validatoren duerfen nur explizite Modellfelder auswerten (z. B. `skillId`, `activitiesRequested`, `relationshipsRequested`).
- Wenn der LLM-Entscheidungsaufruf fehlschlaegt, muss der Fallback im Trace klar erkennbar sein.
- `activitiesRequested` steht fuer Erinnerungen, Verlauf, zeitliche Rueckblicke und Ereignisse.
- `relationshipsRequested` steht fuer Ontologie-/Beziehungswissen (Freundschaft, Herkunft, Orte, Objekte, Beziehungstypen).

## Typische Tasks

- **Neuen Character hinzufuegen**  
  YAML in `content/characters/` + `public/content/characters/` anlegen, Manifest ergaenzen.

- **Lernziel erweitern**  
  `example_questions` und optional `practice_ideas` in beiden Lernziel-Dateien pflegen, dann UI pruefen.

- **Place korrigieren**  
  Beschreibung in beiden Place-Dateien angleichen, Build pruefen.

## Wichtige Dateien

- `src/content/types.ts`
- `src/content/validators.ts`
- `src/content/loaders.ts`
- `src/App.tsx`

## Tool-Response Muster

- Bei tool-gebundenen Antworten in 2 Schritten arbeiten: zuerst kurzer Statussatz ("Ich schaue kurz nach..."), dann Tool ausfuehren, danach Ergebnissatz.
- Vor Tool-Ergebnis keine Erfolgsaussagen formulieren ("gefunden", "fertig", "hier ist es").
- Bei Tool-Fehlern oder leerem Ergebnis transparent, kurz und kindgerecht sagen, was passiert ist, und direkt einen Retry anbieten.
- Fuer Bild-Generierung immer explizite `selectedReferences` mit `reason` uebergeben, statt impliziter Kandidatenwahl.
- Fuer bestehende Bilder nur `show_image` verwenden; Legacy-API-Pfade gelten nur zur Kompatibilitaet.
- Fuer Relationship-Reverse-Lookups `GET /api/relationships/by-object?type=<type>&id=<id>` nutzen; Zusatzobjekte liegen in `other_related_objects`.
