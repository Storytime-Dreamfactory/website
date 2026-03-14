# Step 2 Design: Conversation-Projektion aus Realtime-Events

## Ziel

Conversations werden in Schritt 2 als nachgelagerte Projektion aus demselben Event-Backbone aufgebaut, ohne den Realtime-Ingress erneut zu verkomplizieren.

## Eingangsereignisse

- `voice.session.requested`
- `voice.user.transcript.received`
- `voice.assistant.transcript.received`
- `voice.session.ended`
- `voice.session.failed`

## Projektionstabellen

- `conversations`
- `conversation_messages`

## Mapping

- `conversationId`: aus `conversationKey` (falls gesetzt), sonst deterministisch aus `correlationId`.
- Session Start:
  - upsert `conversations` mit `started_at`, `character_id`, `metadata`.
- Transkripte:
  - insert in `conversation_messages` mit `role`, `content`, `event_type`, `metadata`.
- Session Ende/Fehler:
  - `ended_at` setzen und Endgrund in `metadata` mergen.

## Reihenfolge und Konsistenz

- Consumer liest SQS-Batches.
- Innerhalb eines `correlationId` werden Events nach `occurredAt` sortiert, falls out-of-order.
- Schreiboperationen idempotent auslegen:
  - `message_id` aus `eventId` ableiten (oder separate dedupe-Tabelle auf `eventId`).

## Reprocessing

- DLQ-Events koennen nach Fix per Redrive erneut verarbeitet werden.
- Fuer Bulk-Rebuild kann Event-Historie aus Archivquelle (optional) replayed werden.

## Go-Live-Gate fuer Schritt 2

- 10/10 Sessions erzeugen konsistente Conversation-Historie ohne Duplikate.
- Keine offenen DLQ-Nachrichten ueber vereinbartes Zeitfenster.
