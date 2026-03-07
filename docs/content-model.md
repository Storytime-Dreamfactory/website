# Content Model

Diese Datei beschreibt das YAML-Schema für Storytime-Content.

## Allgemeine Regeln

- Dateinamen: `kebab-case.yaml`
- Encoding: UTF-8
- Pflichtfelder muessen vorhanden und nicht leer sein
- Listenfelder sind echte YAML-Listen (`- item`)

## Character

Pfad: `content/characters/*.yaml` und `public/content/characters/*.yaml`

```yaml
name: Yoko
description: A wise old owl...
history:
  - Event 1
  - Event 2
```

Pflichtfelder:
- `name: string`
- `description: string`
- `history: string[]`

## Place

Pfad: `content/places/*.yaml` und `public/content/places/*.yaml`

```yaml
name: Crystal Lake
description: A clear, sparkling lake...
```

Pflichtfelder:
- `name: string`
- `description: string`

## Skill

Pfad: `content/skills/*.yaml` und `public/content/skills/*.yaml`

```yaml
name: Kindness
description: Helping children understand...
quiz_examples:
  - Question 1?
  - Question 2?
```

Pflichtfelder:
- `name: string`
- `description: string`
- `quiz_examples: string[]`

## Prompt-Bausteine

Pfad: `content/prompts/*.yaml` und `public/content/prompts/*.yaml`

Beispiel:

```yaml
story_request:
  child_name: Alex
  characters:
    - Yoko
  place: Crystal Lake
  skill: Kindness
rules:
  - End with a short quiz.
```

## Runtime-Manifest

`public/content-manifest.json` definiert, welche YAML-Dateien die App zuerst zur Laufzeit laden soll.

Wenn Runtime-Laden fehlschlaegt, nutzt die App den Build-Time-Fallback aus `content/`.
