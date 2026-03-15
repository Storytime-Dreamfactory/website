# DB Contract Baseline (Source of Truth)

Diese Baseline friert den aktuellen Datenbankvertrag fuer die AWS-Migration ein.

## Referenzquellen im Code

- `src/server/conversationStore.ts`
- `src/server/activityStore.ts`
- `src/server/relationshipStore.ts`
- SQL-Ausrollung: `infra/terraform/sql/001_schema.sql`
- SQL-Ausrollung Character-Creation: `infra/terraform/sql/020_character_creation.sql`

## Erforderliche Tabellen

- `conversations`
- `conversation_messages`
- `character_activities`
- `character_relationships`
- `character_creation_jobs`
- `character_creation_steps`
- `character_creation_reference_images`
- `event_outbox`

## Erforderliche Trigger/Funktionen

- Funktion `notify_character_activity_change()`
- Trigger `trg_character_activities_notify_insert`
- Trigger `trg_character_activities_notify_update`

## Erforderliche DB-Features

- PostgreSQL mit `JSONB` und `TEXT[]`
- `GIN`-Indexe fuer `learning_goal_ids` und `other_related_objects`
- `LISTEN/NOTIFY` Kanal `character_activities_changes`

## Kompatibilitaetskriterien

- Keine Umbenennung bestehender Tabellen/Felder in Phase 1
- Keine semantische Aenderung von `is_public`, `activity_type`, `conversation_id`
- Legacy-Daten (`skill_ids`) bleiben lesbar
