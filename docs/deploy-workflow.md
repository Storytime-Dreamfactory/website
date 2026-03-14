# Deploy Workflow (Local -> GitHub -> Vercel -> AWS Content)

Dieser Ablauf ist der Standard fuer Storytime-Deployments.

## 1) Lokal validieren

```bash
npm install
npm run quality:local
```

Optional fuer manuelle UI-Pruefung:

```bash
npm run dev
```

Hinweis: Falls `quality:local` fehlschlaegt, vor dem Push fixen oder bewusst mit Team abstimmen.

## 2) App ueber GitHub nach Vercel deployen

1. Feature-Branch committen.
2. Branch nach GitHub pushen.
3. Pull Request erstellen (GitHub CI startet automatisch: lint, test, build).
4. Vercel Preview URL testen.
5. Nach Merge auf den Hauptbranch laeuft der Production-Deploy automatisch.

## 3) Wann zusaetzlich Content nach AWS deployen?

Fuehre zusaetzlich Content-Deploy aus, wenn eine dieser Dateien/Ordner geaendert wurde:

- `content/**`
- `public/content/**`
- `public/content-manifest.json`

Dann:

```bash
npm run content:deploy:aws
```

Das Skript:

- synchronisiert Runtime-Content in den S3 `content`-Bucket,
- schreibt einen versionierten Snapshot (`versions/<timestamp>/...`),
- spiegelt Assets optional in den `assets`-Bucket.

## 4) Smoke-Checks nach Deploy

Nach jedem Production-Deploy mindestens:

```bash
npm run deploy:smoke -- https://<deine-vercel-domain>
```

Falls die Vercel-URL durch Zugriffsschutz `401` liefern darf (z. B. geschuetzte Preview):

```bash
npm run deploy:smoke -- https://<deine-vercel-domain> 200,401
```

Zusatzcheck im Browser:

- zentrale Story-User-Flows
- bei Content-Deploy: neue/angepasste Characters und Assets sichtbar

## 5) Referenz-Konfiguration

- Vercel-Routing: `vercel.json` (`/api` -> API Gateway, `/content` -> CloudFront)
- Content-Deploy-Skript: `scripts/deploy-content-to-aws.sh`
- Infra-Outputs: `infra/terraform/README.md`
