# Content Model

Diese Datei beschreibt das YAML-Schema für Storytime-Content.

## Allgemeine Regeln

- Dateinamen: `kebab-case.yaml`
- Encoding: UTF-8
- Pflichtfelder muessen vorhanden und nicht leer sein
- Listenfelder sind echte YAML-Listen (`- item`)
- **Jedes Content-Objekt** (Character, Place, Learning Goal, Artifact) traegt immer drei Kopffelder:
  - `id`: UUID (kanonischer fachlicher Schluessel, z. B. `8eb40291-65ee-49b6-b826-d7c7e97404c0`)
  - `name`: lesbarer Anzeigename
  - `type`: exakt `character`, `place`, `learning-goals` oder `artifact`
- Der Ordner-/Dateiname (Slug) dient nur als Storage-Key. Die kanonische ID ist immer die UUID.
- Alle CRUD-Operationen laufen ueber den zentralen `gameObjectService`.

## Objekttypen

| Typ | type-Feld | Pfad-Pattern |
|-----|-----------|--------------|
| Character | `character` | `content/characters/<slug>/character.yaml` |
| Place | `place` | `content/places/<slug>.yaml` |
| Learning Goal | `learning-goals` | `content/learning-goals/<uuid>/<slug>.yaml` |
| Artifact | `artifact` | `content/artifacts/<uuid>/<slug>.yaml` |

## Character

Pfad: `content/characters/<slug>/character.yaml`

```yaml
id: 8eb40291-65ee-49b6-b826-d7c7e97404c0
name: Nola
type: character
kurzbeschreibung: >
  Ein neugieriger kleiner Flussotter mit grossem Herzen, der aus jeder Huerde
  ein spielerisches Abenteuer macht.
basis:
  age_hint: kindlich
  species: Flussotter
  role_archetype: explorer
voice: shimmer
voice_profile:
  identity: >
    Du bist Nola, ein neugieriger kleiner Flussotter mit grossem Herzen und
    spielerischer Energie.
  demeanor: freundlich, geduldig, ermutigend
  tone: warm, bildhaft, kindgerecht
  enthusiasm_level: hoch
  formality_level: locker
  emotion_level: ausdrucksstark
  filler_words: occasionally
  pacing: lebendig mit kurzen Pausen vor wichtigen Fragen
erscheinung:
  body_shape: klein und flink
  colors:
    - warmes braun
    - creme
    - flussblau
  hair_or_fur:
    color: warmes braun
    texture: weich und glatt
    length: kurz
  eyes:
    color: dunkelbraun
    expression: wach und freundlich
  distinctive_features:
    - nasses Fell an den Pfoten
    - kleine Kieseltasche
    - leuchtende Abenteueraugen
  clothing_style: praktisch und verspielt
persoenlichkeit:
  core_traits:
    - neugierig
    - verspielt
    - empathisch
  temperament: lebhaft
  social_style: offen
  strengths:
    - Ideen finden
    - andere mitziehen
  weaknesses:
    - wird schnell ungeduldig
    - denkt nicht immer an den naechsten Schritt
  quirks:
    - sammelt glaenzende Kiesel
    - summt beim Nachdenken
story_psychology:
  visible_goal: bei jedem Abenteuer vorne mit dabei sein
  deeper_need: Zugehoerigkeit
  fear: andere zu enttaeuschen
  insecurity: Ich bin vielleicht zu wild, um hilfreich zu sein.
  stress_response: flight
  growth_direction: lernt, kurz innezuhalten und Hilfe anzunehmen
learning_function:
  teaching_roles:
    - model
    - comic_relief
  suitable_learning_goals:
    - patience
    - problem-solving
  explanation_style: playful
herkunft:
  geburtsort: Crystal Lake
  aufgewachsen_in:
    - Whispering Meadow
    - Crystal Lake
  kulturelle_praegung:
    - naturnahes Leben am Wasser
    - gemeinschaftliches Erzaehlen
  religion_oder_weltbild: sieht Natur und Gemeinschaft als Quelle von Sinn
  historische_praegung:
    - wurde mit alten Geschichten ueber Wasserwege und Tiere gross
  notizen: Herkunft praegt Werte und Perspektive, nicht als Klischee, sondern nuanciert.
bilder:
  standard_figur:
    datei: /content/characters/nola/standard-figur.png
    beschreibung: >
      Freigestellte Ganzkoerperfigur von Nola in neutraler Pose, freundlich,
      neugierig, lesbare Silhouette.
  hero_image:
    datei: /content/characters/nola/hero-image.jpg
    beschreibung: >
      Cinematische Szene am Flussufer im Storytime-Stil, Nola heroisch und
      warm inszeniert.
  portrait:
    datei: /content/characters/nola/portrait.png
    beschreibung: >
      Character-Card-Portrait von Nola, halbnah, freundlich und klar lesbar.
  profilbild:
    datei: /content/characters/nola/profilbild.png
    beschreibung: >
      Quadratisches Profilbild von Nola mit ausdrucksstarkem Gesicht und klarem
      Blick.
  weitere_bilder:
    - typ: emotion_happy
      datei: /content/characters/nola/emotion-happy.png
      beschreibung: Nola freut sich ueber eine neue Entdeckung.
tags:
  - warm
  - playful
  - river
  - problem_solver
metadata:
  active: true
  created_at: 2026-03-08
  updated_at: 2026-03-08
  version: 1
```

Pflichtfelder:
- `id: UUID` (kanonischer Schluessel)
- `name: string`
- `type: 'character'`
- `kurzbeschreibung: string`
- `basis.species: string`
- `voice: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse' | 'marin' | 'cedar'`
- `voice_profile.identity: string`
- `voice_profile.demeanor: string`
- `voice_profile.tone: string`
- `voice_profile.enthusiasm_level: string`
- `voice_profile.formality_level: string`
- `voice_profile.emotion_level: string`
- `voice_profile.filler_words: 'none' | 'occasionally' | 'often' | 'very_often'`
- `voice_profile.pacing: string`
- `erscheinung.body_shape: string`
- `erscheinung.colors: string[]`
- `erscheinung.eyes.color: string`
- `erscheinung.eyes.expression: string`
- `erscheinung.distinctive_features: string[]`
- `erscheinung.clothing_style: string`
- `persoenlichkeit.core_traits: string[]`
- `persoenlichkeit.temperament: string`
- `persoenlichkeit.social_style: string`
- `persoenlichkeit.strengths: string[]`
- `persoenlichkeit.weaknesses: string[]`
- `story_psychology.visible_goal: string`
- `story_psychology.deeper_need: string`
- `story_psychology.fear: string`
- `story_psychology.insecurity: string`
- `story_psychology.stress_response: string`
- `story_psychology.growth_direction: string`
- `learning_function.teaching_roles: string[]`
- `learning_function.suitable_learning_goals: string[]`
- `learning_function.explanation_style: string`
- `bilder.standard_figur: object`
- `bilder.hero_image: object`
- `bilder.portrait: object`
- `bilder.profilbild: object`
- `tags: string[]`
- `metadata.active: boolean`
- `metadata.created_at: string`
- `metadata.updated_at: string`
- `metadata.version: integer >= 1`

Optionale Felder:
- `basis.age_hint`
- `basis.gender_expression`
- `basis.role_archetype`
- `erscheinung.hair_or_fur.*`
- `persoenlichkeit.quirks`
- `herkunft` (gesamter Block optional, wenn vorhanden gelten die Sub-Felder)
- `herkunft.geburtsort: string` (Pflicht innerhalb von `herkunft`)
- `herkunft.aufgewachsen_in: string[]` (Pflicht innerhalb von `herkunft`)
- `herkunft.kulturelle_praegung: string[]` (Pflicht innerhalb von `herkunft`)
- `herkunft.historische_praegung: string[]` (Pflicht innerhalb von `herkunft`)
- `herkunft.religion_oder_weltbild`
- `herkunft.notizen`
- `bilder.*.datei`
- `bilder.*.beschreibung`
- `bilder.weitere_bilder[]`

Hinweise:
- Bildpfade zeigen auf abgeleitete Assets unter `public/content/characters/<id>/`.
- Die `bilder`-Eintraege sind die fachliche Zielbeschreibung fuer den Generator. Der Service darf fehlende Dateinamen oder Beschreibungen mit Standardwerten ergaenzen.
- Beschreibungen sollen persoenlichkeits- und stilrelevant sein, aber keine markenrechtlich heiklen IP-Namen enthalten.
- `herkunft` dient als nuancierte Praegung fuer Sprache, Werte, Kultur, Religion, Historie und Blick auf die Welt. Diese Hinweise sollen respektvoll genutzt werden und nicht in Karikaturen oder flache Klischees kippen.
- Character-Relationships werden ausschliesslich in der Relationship-DB gepflegt (API/Store), nicht in Character-YAML.
- Bei neuen Character-Entwuerfen soll vorhandener Content mitgedacht werden, damit Spezies, Rollen, Farben und kulturelle Hintergruende nicht unnötig wiederholt werden.
- `voice` ist die feste Realtime-Stimme des Characters und wird serverseitig fuer neue Voice-Sessions verwendet.
- `voice_profile` ist verpflichtend und wird immer in die Voice-Agent-Instructions injiziert.

## Place

Pfad: `content/places/<slug>.yaml`

```yaml
id: cb8ce8f2-1b10-48b9-8afc-905a7a8d060a
name: Crystal Lake
type: place
description: A clear, sparkling lake...
```

Pflichtfelder:
- `id: UUID`
- `name: string`
- `type: 'place'`
- `description: string`

## Learning Goal

Pfad: `content/learning-goals/<uuid>/<slug>.yaml`

```yaml
id: 313ab6c5-0d07-48d6-aae6-458a0218c020
name: Kindness
type: learning-goals
subject: sozialkompetenz
topic_group: Soziales Lernen
topic: Freundlichkeit im Alltag
subtopic: Kleine freundliche Handlungen
description: Helping children understand...
age_range:
  - 4-6
  - 7-9
practice_ideas:
  - Idee 1
domain_tags:
  - sozial
session:
  duration_minutes: 30
  format: one-at-a-time
  session_goal: Kinder erkennen kleine freundliche Handlungen und koennen sie benennen.
  end_state: Das Kind kann eine freundliche Handlung in einer Alltagsszene vorschlagen.
curriculum:
  domain: Sozial-emotionales Lernen
  tags:
    - sozial
    - empathie
  prior_knowledge:
    - Das Kind kennt Freundschafts- und Familiensituationen.
teaching_content:
  core_ideas:
    - Freundlichkeit zeigt sich in kleinen Handlungen.
  key_vocabulary:
    - helfen
    - teilen
  examples:
    - Ein Kind troestet ein anderes.
  misconceptions:
    - freundlich sein bedeutet, immer alles abzugeben
didactics:
  pedagogy:
    - spielerisches Lernen
    - scaffolding
  character_role: Der Character fuehrt durch alltagsnahe Situationen und bestaerkt gute Ideen.
  teaching_steps:
    - Einstieg ueber eine kleine Szene
  interaction_rules:
    - eine Frage nach der anderen
learning_objectives:
  - id: identify-kind-action
    can_do: Das Kind kann eine freundliche Handlung in einer Situation erkennen.
    evidence:
      - benennt Hilfe oder Ruecksicht
quiz:
  goal: Das Quiz prueft Verstehen, Anwenden und kleinen Transfer.
  assessment_targets:
    - Alltagssituationen verstehen
  allowed_question_types:
    - situational_open
  example_questions:
    - What is one kind thing you can do for a friend?
  example_tasks:
    - Nenne eine freundliche Idee fuer die Szene.
  answer_expectations:
    strong_signals:
      - benennt eine konkrete freundliche Handlung
    acceptable_signals:
      - erkennt, dass jemand Hilfe braucht
    weak_signals:
      - bleibt sehr vage
    misconception_signals:
      - Freundlichkeit wird mit Gehorsam verwechselt
  feedback_strategy:
    encouragement_style: warm und bestaerkend
    hint_sequence:
      - Was braucht die andere Person gerade?
    follow_up_prompts:
      - Faellt dir noch eine zweite freundliche Idee ein?
```

Pflichtfelder:
- `id: UUID`
- `name: string`
- `type: 'learning-goals'`
- `subject: string`
- `topic_group: string`
- `topic: string`
- `description: string`
- `quiz.example_questions: string[]`

Optionale Felder:
- `subtopic: string`
- `age_range: string[]`
- `practice_ideas: string[]`
- `domain_tags: string[]`
- `session.*`
- `curriculum.*`
- `teaching_content.*`
- `didactics.*`
- `learning_objectives[]`
- `quiz.*`

Hinweise:
- Ein `Learning Goal` beschreibt eine einzelne, in etwa 30 Minuten vermittel- und quizbare Lerneinheit.
- Learning-Goals liegen in einem UUID-Ordner; der Dateiname bleibt der fachliche Slug.
- `topic_group` ist die grobe Themenklammer wie `Demokratie`, `Englisch`, `Geschichte` oder `Soziales Lernen`.
- `topic` beschreibt die konkrete Session, nicht das ganze Fachgebiet.
- Das Quiz bleibt LLM-gestuetzt und offen formuliert; `quiz.example_questions` sind Beispiele, keine starre Fragensammlung.
- Wichtig fuer die spaetere Auswertung sind vor allem `learning_objectives`, `quiz.assessment_targets` und `quiz.answer_expectations`.

## Artifact

Pfad: `content/artifacts/<uuid>/<slug>.yaml`

Artifacts sind generische Objekte (Gegenstaende, magische Items, Werkzeuge, etc.).

```yaml
id: a1b2c3d4-e5f6-7890-abcd-ef1234567890
name: Zauberstab der Weisheit
type: artifact
artifact_type: wand
description: >
  Ein alter, knorriger Stab aus Eichenholz, der bei Beruehrung leise summt.
appearance:
  form: schlanker Holzstab mit gebogener Spitze
  size: etwa unterarmlang
  materials:
    - Eichenholz
    - Mondsilber
  colors:
    - warmes braun
    - mattes silber
  condition: gut gepflegt, mit feinen Gebrauchsspuren
  distinctive_features:
    - spiralfoermige Maserung
    - kleine eingelassene Sternenrunen
function:
  primary_purpose: fokussiert kleine Licht- und Suchzauber
  secondary_purposes:
    - zeigt im Mondlicht versteckte Spuren
  activation: reagiert auf ruhige, klare Sprache
  effects:
    - die Spitze beginnt sanft silbern zu leuchten
    - ein leises Summen wird hoerbar
  limitations:
    - verliert Kraft bei Hektik und lautem Streit
sensory_profile:
  sound: leises, gleichmaessiges Summen
  scent: harzig und frisch
  texture: glatt poliertes Holz
  aura: ruhig und wach
origin:
  creator: unbekannte Waldwerkstatt
  era: alt, aber nicht antik
  cultural_context: wurde als Werkzeug fuer achtsame Nachtwanderungen gefertigt
  inscriptions:
    - Licht zeigt den sanften Weg.
images:
  standard_artifact:
    file: /content/artifacts/a1b2c3d4-e5f6-7890-abcd-ef1234567890/standard-artifact.png
    description: Freigestelltes Artifact in neutraler, gut lesbarer Produktansicht.
  hero_image:
    file: /content/artifacts/a1b2c3d4-e5f6-7890-abcd-ef1234567890/hero-image.jpg
    description: Cinematische Szene mit dem Artifact als visuellem Fokus.
  portrait:
    file: /content/artifacts/a1b2c3d4-e5f6-7890-abcd-ef1234567890/portrait.png
    description: Halbnahe, card-taugliche Darstellung des Artifacts.
tags:
  - magical
  - guiding
  - wooden
metadata:
  active: true
  created_at: 2026-03-13
  updated_at: 2026-03-13
  version: 1
```

Pflichtfelder:
- `id: UUID`
- `name: string`
- `type: 'artifact'`
- `artifact_type: string` (frei taxonomisch, z. B. `wand`, `book`, `amulet`)
- `description: string`
- `appearance.form: string`
- `appearance.materials: string[]`
- `appearance.colors: string[]`
- `appearance.condition: string`
- `appearance.distinctive_features: string[]`
- `function.primary_purpose: string`
- `function.effects: string[]`
- `images.standard_artifact.file: string`
- `images.hero_image.file: string`
- `images.portrait.file: string`
- `tags: string[]`
- `metadata.active: boolean`
- `metadata.created_at: string`
- `metadata.updated_at: string`
- `metadata.version: integer >= 1`

Optionale Felder:
- `appearance.size: string`
- `function.secondary_purposes: string[]`
- `function.activation: string`
- `function.limitations: string[]`
- `sensory_profile.*`
- `origin.*`
- `images.*.description: string`

Hinweise:
- Artifacts werden ueber ihre eigenen Eigenschaften beschrieben, nicht ueber ihre Beziehungen.
- `relationships`-Bloecke sind in Artifact-YAMLs nicht erlaubt; Beziehungen liegen ausschliesslich in der Relationship-DB/API.
- Ablage- oder Pfad-Metadaten wie `content_folder` gehoeren nicht in das Artifact-YAML.

## Agentische Skills und Tools

- `Lernziele` beschreiben den fachlichen Inhalt, den Kinder lernen oder erkunden sollen.
- `Skills` beschreiben agentisches Verhalten wie `visual-expression` oder `run-quiz`.
- `Tools` sind konkrete Runtime-Aktionen wie Bild generieren, bestehendes Bild anzeigen, Hintergrund wechseln oder Activities lesen.
- Agentische Skills leben nicht in `content/learning-goals/`, sondern als Prompt-/Playbook-Bibliothek unter `content/prompts/agent-skills/`.
- Die technische Runtime-Trennung (Router/Skills/Tools/Scripts) ist in `docs/runtime-architecture.md` dokumentiert.

## Conversation-Bildassets (Runtime)

Conversation-Bilder sind Runtime-Assets (kein statischer YAML-Content):

- Dateien werden unter `public/content/conversations/<conversationId>/` gespeichert.
- Conversation-Messages und Activities halten Bildreferenzen in `metadata`.

Wichtige Metadata-Felder bei Bild-Events:

- `heroImageUrl`: stabile URL fuer UI-Hintergrund (bevorzugt lokal)
- `imageUrl`: Hauptbild-URL
- `imageLinkUrl`: URL fuer "Bild ansehen"
- `originalImageUrl`: externe Ursprungs-URL vom Bilddienst
- `imageAssetPath`: lokaler Serverpfad der gespeicherten Datei
- `interactionTargets`: strukturierte Interaktionsziele (z. B. weitere Figuren) als Liste von Objekten mit `type`, `id`, optional `name`, `interactionType`, `role`
- `interactionTargetIds`: flache, deduplizierte IDs im Format `<type>:<id>` fuer schnelle Filter/Joins
- `interactionCharacterIds`: Teilmenge der Interaktionen nur fuer `type=character`

Damit kann ein Character spaeter Bilder aus frueheren Conversations wieder anzeigen, ohne neue Generierung.

## Prompt-Bausteine

Pfad: `content/prompts/*.yaml`

Agentische Skill-Playbooks liegen zusaetzlich unter `content/prompts/agent-skills/*.md`.

Beispiel:

```yaml
story_request:
  child_name: Alex
  characters:
    - Nola
  place: Crystal Lake
  learning_goal: Kindness
rules:
  - End with a short quiz.
```

## Runtime-Manifest

`public/content-manifest.json` definiert, welche YAML-Dateien die App zuerst zur Laufzeit laden soll.

Das Manifest enthaelt die Schluessel `characters`, `places`, `learningGoals` und `artifacts`.

Im Dev-Modus servt das `contentYamlPlugin` (Vite-Middleware) YAML-Dateien direkt aus `content/`. Im Production-Build greift der Build-Time-Fallback (`import.meta.glob` aus `content/`). YAML-Dateien werden nicht nach `public/content/` gespiegelt; dort liegen nur generierte Assets (Bilder).

## gameObjectService

Alle Content-Objekte werden ueber den zentralen `gameObjectService` (`src/server/gameObjectService.ts`) verwaltet:

- `get(id)` -- Objekt per UUID holen (Fallback: Slug-Lookup fuer Legacy-Daten)
- `getBySlug(type, slug)` -- Objekt per Typ und Storage-Slug holen
- `create(input)` -- neues Objekt anlegen (YAML + Spiegel)
- `update(id, patch)` -- Objekt aktualisieren
- `remove(id)` -- Objekt loeschen
- `listByType(type)` / `listAll()` -- Listen
- `getContext(id)` / `getContextBatch(ids)` -- lesbaren Kontext (Name, Typ, Slug) liefern

Relationship-Store und Activity-Store nutzen UUIDs als Referenzen und `getContextBatch` fuer die Aufloesung lesbarer Labels.
