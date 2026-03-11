# Agent Rules

Diese Regeln gelten repo-weit fuer AI-Agents und Contributors.

## Reihenfolge

1. `docs/content-model.md` lesen, bevor Character-Content geaendert wird.
2. `docs/visual-style-guide.md` lesen, bevor Bildprompts, Stilprofile oder Referenzbilder angepasst werden.
3. `content/AGENTS.md` lesen, wenn Character-YAML gepflegt wird.
4. `content/prompts/README.md` lesen, wenn Prompt-Bausteine oder die Generator-CLI erweitert werden.

## Character-Workflow

1. Character-Daten in `content/characters/<id>/character.yaml` pflegen (Single Source of Truth).
2. `public/content-manifest.json` aktuell halten.
3. Bildziele nur ueber das Character-YAML beschreiben, nicht verstreut in Code-Kommentaren oder Ad-hoc-Prompts.
4. Generierte Assets unter `public/content/characters/<id>/` ablegen (Bilder, keine YAMLs).
5. Relationship-Daten ausschliesslich ueber die Relationship-DB/API pflegen; keine `relationships`-Bloecke in Character-YAMLs verwenden.

YAML-Dateien werden NICHT nach `public/content/` gespiegelt. Im Dev-Modus servt das `contentYamlPlugin` die YAMLs direkt aus `content/`. Im Production-Build greift der Build-Time-Fallback (`import.meta.glob`).

## Bildgenerierung

- Nutze fuer neue Character-Assets die CLI in `tools/character-image-service/src/cli.ts`.
- API-Secrets gehoeren ausschliesslich in Umgebungsvariablen wie `BFL_API_KEY`.
- Keine API-Keys, Tokens oder Dashboard-Screenshots committen.
- Der Stil ist eine eigene Storytime-Bildsprache. Prompts duerfen keine direkten Film- oder Marken-IPs imitieren oder benennen.
- Charakteridentitaet ist wichtiger als Effekte: Gesichtsform, Augen, Farben und `distinctive_features` muessen stabil bleiben.
- Der Character-Draft soll immer vorhandene YAMLs mitdenken, damit Vielfalt steigt und bestehende Figuren nicht stumpf dupliziert werden.
- Herkunft, Kultur, Religion und Historie duerfen als Praegung einfliessen, aber nur respektvoll und ohne vereinfachende Karikaturen.

## Prompting Guardrails

- Subjekt und Identitaet zuerst nennen, dann Szene, Licht und Atmosphaere.
- Fuer wiederkehrende Figuren Referenzbilder und Seeds nicht stillschweigend wechseln.
- Keine fotorealistischen, horrorartigen, sexualisierten oder grimdark Ergebnisse anstreben.
- Keine stillen Schema-Erweiterungen ohne Update in `docs/content-model.md`.

## Runtime-Entscheidungen (LLM-first)

- Skill-Routing, Tool-Selektion und Kontext-Reads (`activitiesRequested`, `relationshipsRequested` usw.) sind LLM-basierte Entscheidungen.
- Regex- oder Keyword-Matching darf NICHT als produktive Entscheidungslogik fuer Runtime-Routing genutzt werden.
- Deterministische Parser (z. B. JSON-Parsing, Schema-Validierung, Normalisierung) sind erlaubt, aber nur zur Auswertung expliziter Modellausgaben.
- Falls ein LLM-Call fehlschlaegt, ist ein klarer Fallback erlaubt; dieser muss als degradierter Modus erkennbar sein (Tracing/Logs).

## Conversation-Trace Inspector

Interner Debug-Loop, um Prompt-Collations und Runtime-Entscheidungen schnell nachzuvollziehen.

### API-Endpunkte

- `GET /api/conversations/latest-inspect?characterId=<id>` — liefert die zuletzt gestartete Conversation eines Characters mit allen Messages und allen Activities (public + private: `tool.*`, `trace.*`, `runtime.*`, `skill.*`).
- `GET /api/conversations/inspect?conversationId=<id>` — dasselbe fuer eine bekannte Conversation-ID.

### Workflow fuer Agents

1. Character-ID oder Slug ermitteln (z. B. `raina`).
2. `/api/conversations/latest-inspect?characterId=<id>` aufrufen.
3. Im Response `messages` nach `user`- und `assistant`-Turns scannen.
4. In `activities` die Eintraege nach `activityType` filtern:
   - `trace.runtime.*` — Routing-Entscheidungen (Skill-Wahl, Context-Requests).
   - `trace.skill.*` — Skill-Ausfuehrung (Prompt-Input, Scene-Summary, Image-Prompt).
   - `trace.tool.*` — Tool-Aufrufe (Bild-Generierung, Quiz, Memory).
   - `conversation.scene.directed` — Szenen-Metadata inkl. `groundedSceneCharacters`.
5. Aus den `metadata`-Feldern der Activities die relevanten Prompt-Texte und Context-Collations extrahieren.
6. Feedback-Vorschlaege an den User zurueckgeben oder direkt Prompt-/YAML-Aenderungen vorschlagen.

### Service-Architektur

- `src/server/debugConversationReadService.ts` buendelt Conversation + Messages + Activities.
- Nutzt `conversationStore.getLatestConversationForCharacter()` und `activityStore.listActivities()`.
- Keine eigene Datenhaltung — alles wird ueber bestehende Stores gelesen.

## Prompt-Karte

Alle Runtime-Prompts sind in externen Dateien gespeichert. Hier die vollstaendige Zuordnung:

### Runtime-Prompts (Conversation-Flow)

| Datei | Steuert | Geladen von |
|-------|---------|-------------|
| `content/prompts/runtime/intent-router-system.md` | Skill-Routing: Welcher Skill wird gewaehlt (create_scene, remember-something, request-context, evaluate-feedback) | `intentRouter.ts` → `loadRouterSystemPrompt()` |
| `content/prompts/runtime/scene-summary-system.md` | Scene-Summary: 2-4 Satz Szenenbeschreibung fuer die naechste Bildszene | `createSceneBuilder.ts` → `loadSceneSummaryPrompt()` |
| `content/prompts/runtime/image-prompt-system.md` | Image-Prompt: Bildgenerierungs-Prompt aus der Szenenbeschreibung | `createSceneBuilder.ts` → `loadImagePromptPrompt()` |
| `content/prompts/character-voice-agent.md` | Character-Stimme: Persoenlichkeit, Sprechklang, Gespraechsregeln, Tool-Nutzung | `realtimePlugin.ts` → `loadPromptTemplate()` |

### Skill-Playbooks

| Datei | Skill-ID | Zweck |
|-------|----------|-------|
| `content/prompts/agent-skills/create_scene.md` | `create_scene` | Geschichte um sichtbare Szene fortsetzen |
| `content/prompts/agent-skills/remember-something.md` | `remember-something` | Erinnerungen an fruehere Szenen/Bilder |
| `content/prompts/agent-skills/request-context.md` | `request-context` | Kontext fuer Welt und Objekte holen |
| `content/prompts/agent-skills/evaluate-feedback.md` | `evaluate-feedback` | Meta-Feedback zur Qualitaet entgegennehmen |

### Weitere Prompt-Dateien

| Datei | Zweck |
|-------|-------|
| `content/prompts/character-agent-brief.md` | Character-YAML-Erstellung (Agent-Briefing) |
| `content/prompts/story-request-template.yaml` | Story-Anfrage-Vorlage |
| `content/prompts/README.md` | Prompt-Guide und Konventionen |

## Eval-System (Self-Iteration)

Der Character erkennt Meta-Feedback im Gespraech und startet automatisch einen Verbesserungs-Flow.

### Ablauf

1. User gibt dem Character Feedback ("Das Bild passte nicht zu dir", "Die Szene war langweilig").
2. Intent-Router erkennt `evaluate-feedback` als Skill.
3. Skill speichert `eval.feedback.submitted` Activity mit Feedback-Text und Conversation-Kontext.
4. Character bestaetigt das Feedback freundlich und fuehrt das Gespraech weiter.
5. Eval-Prozessor (async, `src/server/evalProcessor.ts`) wird durch Activity-Listener getriggert:
   - Laedt den Conversation-Trace via `inspectConversation()`.
   - Diagnostiziert per LLM welcher Prompt verantwortlich ist.
   - Generiert eine verbesserte Version des identifizierten Prompts.
   - Schreibt die verbesserte Prompt-Datei.
   - Dokumentiert die Aenderung als `eval.feedback.processed` Activity.
6. Die naechste Conversation nutzt automatisch den verbesserten Prompt.

### Manuelles Iterieren

Prompts koennen auch direkt in den Markdown-Dateien editiert werden. Da die Dateien per `readFile` geladen werden (mit einmaligem Cache), wird ein Server-Neustart noetig, damit Aenderungen wirksam werden.

### Monitoring

- `eval.feedback.submitted` Activities zeigen eingereichtes Feedback.
- `eval.feedback.processed` Activities zeigen das Ergebnis (status: `prompt-updated`, `no-change-needed`, `diagnosis-failed`).
- Bei `prompt-updated` enthalten die Metadata: `targetPromptPath`, `problem`, `suggestion`, `promptLengthBefore/After`.
