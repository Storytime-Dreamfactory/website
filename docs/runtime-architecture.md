# Runtime Architecture

Diese Datei beschreibt die technische Trennung zwischen Skills, Tools und Scripts in der Character-Runtime.

## Begriffe

- `Skill`: Verhaltens- und Ablauflogik (wann ein Character etwas tut)
- `Tool`: deterministische, testbare Runtime-Faehigkeit mit klarer Eingabe/Ausgabe
- `Script`: CLI-/Ops-Helfer ausserhalb der Runtime

## Verzeichnisstruktur

- `src/server/runtime/router/`
  - Intent-Erkennung und Routing-Entscheidungen
- `src/server/runtime/skills/`
  - Skill-Ausfuehrung (z. B. quiz, visual expression, memory recall)
- `src/server/runtime/tools/`
  - Tool-Handler und Tool-Registry
- `scripts/`
  - lokale Dev-/DB-/Smoke-Skripte

## Laufzeitfluss

1. Message kommt in `conversationsPlugin` an.
2. `characterRuntimeOrchestrator` laedt Runtime-Kontext.
3. `runtime/router/intentRouter` entscheidet Skill + Kontextflags.
4. benoetigte Read-Tools werden via `runtime/tools/runtimeToolRegistry` ausgefuehrt.
5. Skill-Ausfuehrung passiert via `runtime/skills/skillExecutor`.
6. Activities und Conversation-Messages werden wie bisher in Store/DB geschrieben.

## Tool-Registry

Die Tool-Registry lebt in `src/server/runtime/tools/runtimeToolRegistry.ts`.

Aktuell registrierte Read-Tools:

- `read_activities`
- `read_relationships`
- `read_related_objects`

Alle Tool-Handler nutzen einen gemeinsamen `RuntimeToolContext` und koennen zentral Activity-Logging ueber `runtimeToolActivityLogger` ausfuehren.

## API-Adapter-Prinzip

- Plugins unter `src/server/*Plugin.ts` bleiben HTTP-Adapter.
- Fachlogik soll in Services (`...ToolService.ts`) oder Runtime-Tool-Handlern liegen.
- Ziel: Plugins lesen Request/Response, aber enthalten keine tiefe Domainlogik.
