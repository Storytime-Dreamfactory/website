# Migration Readiness Checklist

## Infrastruktur

- [x] `terraform apply` erfolgreich fuer `infra/terraform`
- [x] `api_base_url` Output vorhanden
- [x] `rds_endpoint` Output vorhanden
- [x] `runtime_secret_arn` Output vorhanden
- [x] `eventbridge_bus_name` Output vorhanden
- [x] `content_cdn_domain` Output vorhanden

## Datenbank

- [x] `sql/001_schema.sql` erfolgreich auf RDS ausgefuehrt
- [x] Tabellen vorhanden: `conversations`, `conversation_messages`, `character_activities`, `character_relationships`
- [x] Trigger/Funktion fuer `character_activities_changes` vorhanden
- [x] SSL-Connection zur DB verifiziert

## API-Kompatibilitaet

- [x] `GET /health` liefert `200`
- [x] `GET /ready` liefert `200`
- [x] Alle produktiven Pfade aus `endpoint-matrix.md` erreichbar
- [x] Legacy-Aliase `/api/gameobjects/*` und `/api/tools/display-existing-image` erreichbar

## Security/Secrets

- [x] Runtime Secret in Secrets Manager gepflegt (API Keys + DB URL)
- [x] Lambda-Role hat nur minimal noetige Rechte
- [x] RDS SG akzeptiert nur Zugriff aus Lambda SG

## Eventing

- [x] EventBridge Bus existiert
- [x] App-Konfiguration nutzt `ACTIVITY_EVENTBRIDGE_ENABLED=true`
- [x] `createActivity` erzeugt DB-Eintrag und EventBridge-Event (Dual-Write)

## Go/No-Go fuer Service-Migration

- [x] Observability aktiv (CloudWatch Logs + Alarme)
- [x] Rollback-Plan dokumentiert
- [x] Reihenfolge je Service-Domaene festgelegt (activities -> conversations -> tools -> realtime)
- [x] `phase2-service-migration-runbook.md` fuer Phase 2 freigegeben
