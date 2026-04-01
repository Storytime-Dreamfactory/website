# Runbook: Lokal, Remote-API, Production

Dieses Runbook legt fest, wann welcher Modus genutzt wird und welche Gates vor Push/Deploy zwingend sind.

## 1) Modus waehlen

### A) `local-full` (Standard)

Nutzen fuer:
- Feature-Entwicklung und schnelles Iterieren ohne Cloud-Abhaengigkeit.
- Character-Flow-Ende-zu-Ende lokal.

Voraussetzungen:
- `STORYTIME_USE_REMOTE_APIS=false`
- `OPENAI_API_KEY`, `BFL_API_KEY`, `DATABASE_URL` gesetzt

Start:

```bash
npm run dev:local
```

### B) `local-remote-api`

Nutzen fuer:
- Integrationschecks gegen echte AWS-API (Routing, Infra, Auth/Runtime-Verhalten).
- Vollstaendig online testen, ohne lokale Content-/API-Mischung.

Voraussetzungen:
- `STORYTIME_USE_REMOTE_APIS=true`
- `STORYTIME_REMOTE_API_ORIGIN=<api-gateway-origin>`
- optional `STORYTIME_REMOTE_CONTENT_ORIGIN=<cloudfront-origin>`

Start:

```bash
npm run dev:online
```

### C) `production`

Nutzen fuer:
- Finale Abnahme und Live-Verifikation nach Merge/Deploy.

Hinweis:
- Frontend: Vercel
- API: AWS API Gateway
- Content: CloudFront/S3

## 2) Verbindliche Gates

Vor jedem Push:

```bash
npm run quality:local
```

Vor Release/Abnahme (empfohlen):

```bash
npm run character-creation:smoke -- --base-url=http://localhost:5173
```

Nach Production-Deploy:

```bash
npm run deploy:smoke -- https://<deine-vercel-domain>
npm run character-creation:smoke -- --base-url=https://<deine-vercel-domain>
```

## 3) Entscheidungsregeln

- Neue Features oder Bugfixes zuerst in `local-full`.
- Wenn Verhalten API/Infra-abhaengig ist, gezielt in `local-remote-api` reproduzieren.
- In `local-remote-api` gibt es keinen lokalen YAML-Fallback mehr; Fehler sind damit echte Online-Fehler.
- Erst nach bestandenen Gates pushen/deployen.
- Moduswechsel nur mit Neustart des Dev-Servers.

## 4) Typische Fehler schnell einordnen

- `OPENAI_API_KEY fehlt ...`: lokaler Modus ohne vollstaendige `.env`; `npm run preflight:env:local-full` ausfuehren.
- `Unbekannter API-Fehler`: sollte durch verbesserten Error-Contract nicht mehr generisch auftreten; Response-Status und Endpoint werden jetzt mitgegeben.
- `DATABASE_URL fehlt`: DB-Features lokal nicht initialisiert; `npm run db:start` und korrekte `DATABASE_URL` setzen.
