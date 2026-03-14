-- Storytime baseline schema for AWS Postgres

CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  user_id TEXT,
  character_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  message_id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(conversation_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  event_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_conversations_character_id
  ON conversations (character_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation
  ON conversation_messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversation_messages_created_at
  ON conversation_messages (created_at DESC);

CREATE TABLE IF NOT EXISTS character_activities (
  activity_id TEXT PRIMARY KEY,
  activity_type TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT FALSE,
  character_id TEXT,
  place_id TEXT,
  learning_goal_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  skill_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  conversation_id TEXT,
  subject JSONB NOT NULL DEFAULT '{}'::jsonb,
  object JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  story_summary TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_character_activities_character_id
  ON character_activities (character_id);
CREATE INDEX IF NOT EXISTS idx_character_activities_conversation_id
  ON character_activities (conversation_id);
CREATE INDEX IF NOT EXISTS idx_character_activities_place_id
  ON character_activities (place_id);
CREATE INDEX IF NOT EXISTS idx_character_activities_type
  ON character_activities (activity_type);
CREATE INDEX IF NOT EXISTS idx_character_activities_is_public
  ON character_activities (is_public);
CREATE INDEX IF NOT EXISTS idx_character_activities_occurred_at
  ON character_activities (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_character_activities_learning_goal_ids
  ON character_activities USING GIN (learning_goal_ids);

CREATE OR REPLACE FUNCTION notify_character_activity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify(
      'character_activities_changes',
      json_build_object(
        'event', 'created',
        'activityId', NEW.activity_id
      )::text
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.story_summary IS DISTINCT FROM OLD.story_summary THEN
      PERFORM pg_notify(
        'character_activities_changes',
        json_build_object(
          'event', 'updated',
          'activityId', NEW.activity_id
        )::text
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_character_activities_notify_insert ON character_activities;
DROP TRIGGER IF EXISTS trg_character_activities_notify_update ON character_activities;

CREATE TRIGGER trg_character_activities_notify_insert
AFTER INSERT ON character_activities
FOR EACH ROW
EXECUTE FUNCTION notify_character_activity_change();

CREATE TRIGGER trg_character_activities_notify_update
AFTER UPDATE ON character_activities
FOR EACH ROW
WHEN (OLD.story_summary IS DISTINCT FROM NEW.story_summary)
EXECUTE FUNCTION notify_character_activity_change();

CREATE TABLE IF NOT EXISTS character_relationships (
  relationship_id TEXT PRIMARY KEY,
  source_character_id TEXT NOT NULL,
  target_character_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  relationship_type_readable TEXT,
  relationship TEXT NOT NULL,
  description TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  other_related_objects JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_character_relationships_source
  ON character_relationships (source_character_id);
CREATE INDEX IF NOT EXISTS idx_character_relationships_target
  ON character_relationships (target_character_id);
CREATE INDEX IF NOT EXISTS idx_character_relationships_type
  ON character_relationships (relationship_type);
CREATE INDEX IF NOT EXISTS idx_character_relationships_other_related_objects
  ON character_relationships USING GIN (other_related_objects);
