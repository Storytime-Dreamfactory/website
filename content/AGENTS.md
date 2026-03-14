# Content Agent Guide

Diese Regeln gelten fuer redaktionelle Pflege von Storytime-Content.

## Character-Dateien

- Dateiname bleibt `kebab-case.yaml`.
- `name`, `kurzbeschreibung` und alle generatorrelevanten Felder muessen konkret und visuell lesbar sein.
- Beschreibungen sollen kindgerecht, eindeutig und prompt-tauglich sein.
- `distinctive_features` beschreibt wiedererkennbare Merkmale, nicht nur Stimmung.
- `bilder.*.beschreibung` beschreibt das Bildziel und nicht den technischen Workflow.
- `herkunft` beschreibt kulturelle, historische und regionale Praegung nuanciert und respektvoll.
- `voice` und `voice_profile` sind Pflichtfelder in jedem Character-YAML.
- `voice_profile` muss charakterbezogen und konkret ausgefuellt werden (`identity`, `demeanor`, `tone`, `enthusiasm_level`, `formality_level`, `emotion_level`, `filler_words`, `pacing`).
- Relationships werden nicht in Character-YAML gepflegt; dafuer ausschliesslich die Relationship-DB/API verwenden.

## Dateipflege

Character-YAML wird nur in `content/characters/<id>/character.yaml` gepflegt (Single Source of Truth). Es gibt keine Spiegelung nach `public/content/`. Das Vite-Dev-Plugin `contentYamlPlugin` servt die YAMLs direkt aus `content/`.

Nach Aenderungen `public/content-manifest.json` pruefen.

## Gute Character-Beschreibungen

- Beschreibe Koerperform, dominante Farben, Augenwirkung und erkennbare Merkmale konkret.
- Verknuepfe Persoenlichkeit mit sichtbarer Koerpersprache.
- Halte Stilhinweise generisch hochwertig und kindgerecht, nicht markenbezogen.
- Nutze `tags` fuer Retrieval und spaetere Filterbarkeit.
- Nutze `herkunft`, um Werte, Sprache und Perspektive anzudeuten, nicht um starre Stereotype zu reproduzieren.
- Nutze vorhandene Characters und Places als Beziehungskontext, damit neue Figuren ins bestehende Story-Universum passen.

## Schlechte Character-Beschreibungen

- Zu vage: `sieht nett aus`
- Nur Stimmungen ohne Visualisierung: `mag Abenteuer`
- Direkte IP-Referenzen wie Film- oder Studio-Namen
- Widerspruechliche Angaben in `kurzbeschreibung`, `erscheinung` und `bilder`
- Herkunft als plattes Klischee statt als vielschichtige Praegung
