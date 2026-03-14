# Artifact Image Service

Generiert Artifact-Bilder direkt aus den YAML-Dateien, die im `public/content-manifest.json` unter `artifacts` eingetragen sind.

## Befehle

```bash
npm run artifact-images:dry-run
npm run artifact-images:generate
```

## Standardverhalten

- Liest `public/content-manifest.json`
- Iteriert ueber alle `artifacts[]`-Eintraege
- Laedt jedes Artifact-YAML und generiert die 3 Pflichtbilder:
  - `images.standard_artifact.file`
  - `images.hero_image.file`
  - `images.portrait.file`
- Schreibt pro Artifact ein `generation-manifest.json` unter `public/content/artifacts/<uuid>/`

## Optionen

```bash
npm run artifact-images:generate -- \
  --manifest ./public/content-manifest.json \
  --style-reference /abs/path/style.png \
  --artifact-reference /abs/path/reference.png \
  --model flux-2-pro \
  --hero-model flux-2-pro \
  --overwrite
```

## Voraussetzungen

- `BFL_API_KEY` fuer FLUX
- optional:
  - `GOOGLE_GEMINI_API_KEY`
  - `OPENAI_API_KEY`
