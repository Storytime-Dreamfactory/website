# Phase 2 Service Migration Runbook

Ziel: Dienste schrittweise vom Stub auf produktive Lambda-Implementierungen umstellen, ohne Endpoint-Bruch.

## Reihenfolge

1. `game-objects` (abgeschlossen)
2. `relationships` (abgeschlossen)
3. `activities` Read-Path (abgeschlossen)
4. `conversations` (naechster Schritt)
5. `tools` + `images`
6. `realtime`

## Ablauf pro Service-Domaene

1. Neue Lambda-Funktion deployen (`<domain>-service`).
2. API Gateway Route(s) fuer die Domaene vom Stub auf neue Integration umschalten.
3. Smoke-Test der Domaene:
   - erwartete Statuscodes
   - JSON Shape kompatibel
   - Legacy-Aliase weiterhin bedient
4. Monitoring 15-30 Minuten beobachten:
   - Lambda Errors
   - API 5xx
   - p95/p99 Latenz
5. Erst danach naechste Domaene migrieren.

## Rollback

- Route-Zuordnung im API Gateway auf Stub-Lambda zuruecksetzen.
- Falls noetig, Feature-Flags deaktivieren (`ACTIVITY_EVENTBRIDGE_ENABLED`, model flags etc.).
- Keine DB-Rollback-Operation ohne Snapshot-Freigabe.

## Spezifisch fuer Activity-Stream

- Write bleibt Dual-Write (`DB + EventBridge`) waehrend Transition.
- `/api/activities/stream` zunaechst kompatibel halten.
- Realtime-Consumer stabilisieren (WebSocket/AppSync), danach schrittweise SSE ablösen.

## Aktueller Phase-2 Status

- Content-Pipeline aktiv: `scripts/deploy-content-to-aws.sh` deployed `content/` + `public/content/` inkl. versioniertem Snapshot unter `versions/<timestamp>/`.
- Read-Only Frontend live auf Vercel:
  - API-Rewrites nach AWS API Gateway
  - Content-Rewrites nach CloudFront
  - SPA-Fallback via `vercel.json`
- Smoke-Tests erfolgreich fuer:
  - `GET /api/game-objects?type=character`
  - `GET /api/relationships/all`
  - `GET /api/activities`
