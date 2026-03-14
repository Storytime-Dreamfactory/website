# Realtime Event Contract (Step 1)

Dieser Contract gilt fuer den EventBridge-Backbone in Schritt 1.

## Bus und Quelle

- Bus: `${project}-${environment}-activity-bus`
- Source: `storytime.realtime`
- Detail-Type Prefix: `storytime.voice`

## Pflichtfelder im `detail`

- `eventId` (UUID, idempotenter Primärschlüssel)
- `correlationId` (UUID, End-to-End Korrelation pro Session)
- `conversationKey` (optional, fuer spaetere Conversation-Projektion)
- `characterId` (kanonische Character-ID)
- `eventType` (siehe Eventtypen)
- `occurredAt` (ISO-8601 UTC)
- `payload` (objektbasiert, event-spezifisch)
- `schemaVersion` (`1.0`)

## Eventtypen

- `voice.session.requested`
- `voice.instructions.updated`
- `voice.user.transcript.received`
- `voice.assistant.transcript.received`
- `voice.session.ended`
- `voice.session.failed`

## Idempotenz

- Producer: erstellt pro Event ein eindeutiges `eventId`.
- Activity-Projektion: schreibt `eventId` als `activity_id` in `character_activities`.
- Doppelte Events werden via `ON CONFLICT (activity_id) DO NOTHING` gededuped.

## Fehlerbehandlung

- EventBridge Zustellung: Retry + DLQ (`realtime-activity-projection-dlq`).
- Consumer-Fehler: Lambda-Error + SQS-Retry, danach DLQ.
- Monitoring:
  - Lambda Errors (`activity-projector`)
  - DLQ Visible Messages

## Versionierung

- Startversion: `1.0`
- Breaking Changes nur als neue Version (`2.0`) mit paralleler Consumer-Unterstuetzung.
