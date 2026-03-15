-- Character creation job orchestration (Hybrid: Postgres state + SQS delivery)

CREATE TABLE IF NOT EXISTS character_creation_jobs (
  job_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'queued', 'running', 'completed', 'failed')),
  phase TEXT NOT NULL DEFAULT 'draft',
  message TEXT NOT NULL,
  prompt TEXT,
  yaml_text TEXT,
  character_id TEXT,
  content_path TEXT,
  manifest_path TEXT,
  error TEXT,
  fill_missing_fields_creatively BOOLEAN NOT NULL DEFAULT FALSE,
  reference_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_step TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  queued_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_character_creation_jobs_status
  ON character_creation_jobs (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS character_creation_steps (
  job_id TEXT NOT NULL REFERENCES character_creation_jobs(job_id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (job_id, step_name, created_at)
);

CREATE INDEX IF NOT EXISTS idx_character_creation_steps_job_id
  ON character_creation_steps (job_id, created_at DESC);

CREATE TABLE IF NOT EXISTS character_creation_reference_images (
  reference_image_id TEXT PRIMARY KEY,
  storage_bucket TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_outbox (
  outbox_id BIGSERIAL PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_event_outbox_event_key
  ON event_outbox (event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
  ON event_outbox (status, next_attempt_at, created_at);
