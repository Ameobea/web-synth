ALTER TABLE compositions ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE compositions SET created_at = NULL;
