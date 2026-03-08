# Agent Rules

Diese Regeln gelten repo-weit fuer AI-Agents und Contributors.

## Reihenfolge

1. `docs/content-model.md` lesen, bevor Character-Content geaendert wird.
2. `docs/visual-style-guide.md` lesen, bevor Bildprompts, Stilprofile oder Referenzbilder angepasst werden.
3. `content/AGENTS.md` lesen, wenn Character-YAML gepflegt wird.
4. `content/prompts/README.md` lesen, wenn Prompt-Bausteine oder die Generator-CLI erweitert werden.

## Character-Workflow

1. Character-Daten in `content/characters/<id>/character.yaml` pflegen.
2. Dieselbe Datei nach `public/content/characters/<id>/character.yaml` spiegeln.
3. `public/content-manifest.json` aktuell halten.
4. Bildziele nur ueber das Character-YAML beschreiben, nicht verstreut in Code-Kommentaren oder Ad-hoc-Prompts.
5. Generierte Assets unter `public/content/characters/<id>/` ablegen (neben der `character.yaml`).
6. Relationship-Daten ausschliesslich ueber die Relationship-DB/API pflegen; keine `relationships`-Bloecke in Character-YAMLs verwenden.

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
