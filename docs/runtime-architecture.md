# Runtime Architecture

Diese Datei beschreibt die technische Trennung zwischen Skills, Tools und Scripts in der Character-Runtime.

## Begriffe

- `Skill`: Verhaltens- und Ablauflogik (wann ein Character etwas tut)
- `Tool`: deterministische, testbare Runtime-Faehigkeit mit klarer Eingabe/Ausgabe
- `Script`: CLI-/Ops-Helfer ausserhalb der Runtime
- `LLM-Routing`: modellbasierte Entscheidung ueber Skill, Kontextflags und Toolbedarf
- `Runtime Notepad`: freier, sichtbarer Conversation-State in `conversations.metadata.runtime_notepad`

## Verzeichnisstruktur

- `src/server/runtime/router/`
  - LLM-basierte Intent- und Routing-Entscheidungen
- `src/server/runtime/context/`
  - Context-Collation (einheitlicher Relationship-/Activity-/Object-Kontext inkl. Bildreferenzen)
- `src/server/runtime/skills/`
  - Skill-Ausfuehrung (z. B. quiz, visual expression, memory recall)
- `src/server/runtime/tools/`
  - Tool-Handler und Tool-Registry
- `scripts/`
  - lokale Dev-/DB-/Smoke-Skripte

## Laufzeitfluss

1. Message kommt in `conversationsPlugin` an.
2. `characterRuntimeOrchestrator` laedt Runtime-Kontext.
3. `runtime/router/intentRouter` ruft ein LLM fuer die Routing-Entscheidung auf (Skill + Kontextflags).
4. benoetigte Read-Tools werden via `runtime/tools/runtimeToolRegistry` ausgefuehrt.
5. `runtime/context/contextCollationService` vereinheitlicht Kandidaten inkl. Relationship-Typen, Evidenz und Bild-Referenzen.
6. Skill-Ausfuehrung passiert via `runtime/skills/skillExecutor`.
7. Der Agent waehlt aus dem Collated Context explizite `selectedReferences` fuer die Bildgenerierung.
8. Activities und Conversation-Messages werden wie bisher in Store/DB geschrieben.
9. Laufende Plan-/Zwischenergebnisse koennen im Runtime-Notepad persistiert werden.

## Routing-Prinzipien

- Runtime-Routing ist LLM-first und schema-gestuetzt (strukturierte Modellausgabe).
- Regex/Keyword-Heuristiken sind fuer produktive Routing-Entscheidungen nicht erlaubt.
- Fallbacks sind nur fuer Fehlerfaelle gedacht (Timeout, API-Fehler, invalides Modell-JSON) und muessen in Traces/Logs markiert sein.
- Deterministische Logik bleibt fuer Guardrails, Validierung und sichere Tool-Ausfuehrung zustaendig.
- Multi-Intent-Requests sollen bevorzugt ueber `plan-and-act` als sequenzielle Schrittkette laufen.

## Context-Collation Contract

- `CollatedContext` liefert ein einheitliches Modell fuer:
  - `relatedObjects[]` (z. B. Characters, spaeter Places/Items)
  - `activities[]` (Ereignis-/Verlaufskontext)
- Jeder `relatedObject` enthält:
  - `objectType`, `objectId`, `displayName`
  - `relationshipLinks[]` mit `relationshipType`, `fromTitle`, `toTitle`, `relationshipTypeReadable`, `relationship`, `direction`
  - `imageRefs[]` (alle verfuegbaren Referenzen, z. B. hero/standard/portrait/profile)
  - `evidence[]` (warum der Kandidat relevant ist)
- Bildreferenz-Auswahl wird explizit als `selectedReferences[]` mit `reason` transportiert.

## Tool-Registry

Die Tool-Registry lebt in `src/server/runtime/tools/runtimeToolRegistry.ts`.

Aktuell registrierte Read-Tools:

- `read_activities`
- `read_relationships`
- `read_related_objects`
- `read_related_object_contexts`
- `run_cli_task` (runtime-only, allowlisted)

Alle Tool-Handler nutzen einen gemeinsamen `RuntimeToolContext` und koennen zentral Activity-Logging ueber `runtimeToolActivityLogger` ausfuehren.

## Relationship Reverse Lookup

- `character_relationships.other_related_objects` speichert zusaetzliche Objekt-Referenzen als JSONB-Array.
- API-Reverse-Lookup: `GET /api/relationships/by-object?type=<type>&id=<id>`.
- Runtime-Tool `read_related_object_contexts` kann fuer ein Objekt (`objectType` + `objectId`) alle Beziehungs-Kontexte laden, damit der Agent von Objekt -> Beziehung -> weitere Figuren navigiert.

## CLI Gateway Tool (runtime-only)

`run_cli_task` kapselt ausgewaehlte CLI-Tasks hinter einem sicheren Runtime-Tool:

- keine freie Shell-Eingabe, nur `taskId` aus Allowlist
- Argument-Policy mit Guardrails (z. B. Pfade im Workspace, erlaubte Werte)
- `dryRun` zuerst fuer sichere Vorschau
- Timeouts und kontrollierte Fehlerausgabe
- kein HTTP-Endpoint: Nutzung nur intern in Runtime-Skills

## API-Adapter-Prinzip

- Plugins unter `src/server/*Plugin.ts` bleiben HTTP-Adapter.
- Fachlogik soll in Services (`...ToolService.ts`) oder Runtime-Tool-Handlern liegen.
- Ziel: Plugins lesen Request/Response, aber enthalten keine tiefe Domainlogik.
