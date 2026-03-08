# Character Image Service

Der Character Image Service erzeugt ein Standard-Kit an Character-Bildern aus erweitertem Character-YAML.

## Output

Standardmaessig werden generiert:

- `standard_figur`
- `hero_image`
- `portrait`
- `profilbild`
- optionale `weitere_bilder`

Die Assets landen unter `public/content/characters/<id>/` zusammen mit einer `generation-manifest.json`.

## Voraussetzungen

- `BFL_API_KEY` in der Umgebung gesetzt
- Character-YAML gemaess `docs/content-model.md`
- mindestens ein Stil-Referenzbild fuer konsistente Folgebild-Erzeugung

## Dry Run

```bash
npm run character-images:dry-run -- \
  --character ./content/characters/nola.yaml \
  --style-reference /absolute/path/to/storytime-reference.png
```

## Generierung

```bash
npm run character-images:generate -- \
  --character ./content/characters/nola.yaml \
  --style-reference /absolute/path/to/storytime-reference.png \
  --overwrite
```

## Hinweise

- `standard_figur` wird zuerst gebaut und dient danach als Charakterreferenz fuer die restlichen Assets.
- `hero_image` nutzt standardmaessig `flux-2-max`, die anderen Assets `flux-2-pro-preview`.
- Seeds, Prompt, Modell und Output-Pfade werden in `generation-manifest.json` protokolliert.
