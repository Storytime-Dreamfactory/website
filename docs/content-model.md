# Content Model

Diese Datei beschreibt das YAML-Schema für Storytime-Content.

## Allgemeine Regeln

- Dateinamen: `kebab-case.yaml`
- Encoding: UTF-8
- Pflichtfelder muessen vorhanden und nicht leer sein
- Listenfelder sind echte YAML-Listen (`- item`)

## Character

Pfad: `content/characters/<id>/character.yaml` und `public/content/characters/<id>/character.yaml`

```yaml
id: nola
name: Nola
kurzbeschreibung: >
  Ein neugieriger kleiner Flussotter mit grossem Herzen, der aus jeder Huerde
  ein spielerisches Abenteuer macht.
basis:
  age_hint: kindlich
  species: Flussotter
  role_archetype: explorer
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
relationships:
  characters:
    - character_id: romi
      typ: freundin
      beschreibung: Romi und Nola erkunden gemeinsam die Natur am See.
  places:
    - place_id: crystal-lake
      typ: home_waters
      beschreibung: Nola fuehlt sich am See zu Hause.
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
- `id: string`
- `name: string`
- `kurzbeschreibung: string`
- `basis.species: string`
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
- `relationships` (gesamter Block optional)
- `relationships.characters[]`
- `relationships.places[]`
- `bilder.*.datei`
- `bilder.*.beschreibung`
- `bilder.weitere_bilder[]`

Hinweise:
- Bildpfade zeigen auf abgeleitete Assets unter `public/content/characters/<id>/`.
- Die `bilder`-Eintraege sind die fachliche Zielbeschreibung fuer den Generator. Der Service darf fehlende Dateinamen oder Beschreibungen mit Standardwerten ergaenzen.
- Beschreibungen sollen persoenlichkeits- und stilrelevant sein, aber keine markenrechtlich heiklen IP-Namen enthalten.
- `herkunft` dient als nuancierte Praegung fuer Sprache, Werte, Kultur, Religion, Historie und Blick auf die Welt. Diese Hinweise sollen respektvoll genutzt werden und nicht in Karikaturen oder flache Klischees kippen.
- `relationships` ist absichtlich flach gehalten, damit Agents und UI die Verbindungen schnell lesen, bearbeiten und spaeter in Storylogik nutzen koennen.
- Bei neuen Character-Entwuerfen soll vorhandener Content mitgedacht werden, damit Spezies, Rollen, Farben und kulturelle Hintergruende nicht unnötig wiederholt werden.

## Place

Pfad: `content/places/*.yaml` und `public/content/places/*.yaml`

```yaml
name: Crystal Lake
description: A clear, sparkling lake...
```

Pflichtfelder:
- `name: string`
- `description: string`

## Learning Goal

Pfad: `content/learning-goals/*.yaml` und `public/content/learning-goals/*.yaml`

```yaml
name: Kindness
topic: Freundlichkeit im Alltag
description: Helping children understand...
age_range:
  - 3-5
  - 6-8
example_questions:
  - Question 1?
  - Question 2?
practice_ideas:
  - Idee 1
domain_tags:
  - sozial
```

Pflichtfelder:
- `name: string`
- `topic: string`
- `description: string`
- `example_questions: string[]`

Optionale Felder:
- `age_range: string[]`
- `practice_ideas: string[]`
- `domain_tags: string[]`

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

Pfad: `content/prompts/*.yaml` und `public/content/prompts/*.yaml`

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

Wenn Runtime-Laden fehlschlaegt, nutzt die App den Build-Time-Fallback aus `content/`.
