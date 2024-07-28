ALTER TABLE compositions ADD COLUMN IF NOT EXISTS composition_version INT NOT NULL DEFAULT 0;
ALTER TABLE compositions ADD COLUMN IF NOT EXISTS parent_id BIGINT NULL DEFAULT NULL;

ALTER TABLE compositions ADD CONSTRAINT IF NOT EXISTS parent_id_composition_version UNIQUE (parent_id, composition_version);
