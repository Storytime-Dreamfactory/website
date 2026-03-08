# Prompt Guide

Diese Regeln gelten fuer Prompt-Bausteine und den Character Image Service.

## Prompt-Struktur

Reihenfolge fuer robuste FLUX-Prompts:

1. Character-Identitaet
2. Sichtbare Merkmale
3. Asset-Ziel
4. Licht und Atmosphaere
5. Storytime-Stilprofil
6. Guardrails

## Do

- Nenne zuerst die Figur, ihre Spezies, Form, Farben und `distinctive_features`.
- Formuliere in klarer Prosa statt als lose Keyword-Liste.
- Beschreibe Licht konkret: warmes Key Light, kuehler Dunst, klare Tiefenstaffelung.
- Nutze Bildzieltexte aus `bilder.*.beschreibung` als asset-spezifischen Brief.
- Behandle das Character-YAML als Single Source of Truth.

## Don't

- Keine direkten Nennungen von Marken, Studios, Filmtiteln oder Franchise-Figuren.
- Keine vagen Aussagen wie `make it nicer` oder `looks magical`.
- Keine Aenderungen an Identitaetsmerkmalen zwischen `standard_figur`, `hero_image`, `portrait` und `profilbild`.
- Keine fotorealistischen, grimdark oder erwachsenen Stilziele.

## Konsistenzregeln

- `standard_figur` ist die erste kanonische Referenz fuer weitere Assets.
- `hero_image`, `portrait` und `profilbild` muessen dasselbe Gesicht, dieselben Farben und dieselben Merkmale halten.
- Seeds und Referenzbilder in `generation-manifest.json` nachvollziehbar speichern.

## Beispiel-Denke

Schlecht:

`Cute otter, Disney style, cool image`

Gut:

`Nola is a small river otter with warm brown fur, dark brown lively eyes, a small pebble pouch, and a playful practical silhouette. Create a full-body character asset on a clean isolated background. Keep child-friendly proportions, warm cinematic lighting, and the Storytime adventure animation style profile.`
