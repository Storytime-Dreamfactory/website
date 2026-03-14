-- Verifies that schema and triggers are in place.

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'conversations',
    'conversation_messages',
    'character_activities',
    'character_relationships'
  )
ORDER BY table_name;

SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'conversations',
    'conversation_messages',
    'character_activities',
    'character_relationships'
  )
ORDER BY tablename, indexname;

SELECT proname
FROM pg_proc
WHERE proname = 'notify_character_activity_change';

SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_name IN (
  'trg_character_activities_notify_insert',
  'trg_character_activities_notify_update'
)
ORDER BY trigger_name;
