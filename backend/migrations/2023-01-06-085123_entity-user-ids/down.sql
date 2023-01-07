ALTER TABLE compositions ADD COLUMN IF NOT EXISTS author BIGINT(20) NOT NULL DEFAULT '0';
ALTER TABLE compositions DROP CONSTRAINT IF EXISTS compositions_ibfk_1;
ALTER TABLE compositions DROP COLUMN IF EXISTS user_id;

-- need to drop foreign keys before dropping columns
ALTER TABLE effects DROP CONSTRAINT IF EXISTS effects_ibfk_1;
ALTER TABLE effects DROP COLUMN IF EXISTS user_id;

ALTER TABLE midi_compositions DROP CONSTRAINT IF EXISTS midi_compositions_ibfk_1;
ALTER TABLE midi_compositions DROP COLUMN IF EXISTS user_id;

ALTER TABLE synth_presets DROP CONSTRAINT IF EXISTS synth_presets_ibfk_1;
ALTER TABLE synth_presets DROP COLUMN IF EXISTS user_id;

ALTER TABLE voice_presets DROP CONSTRAINT IF EXISTS voice_presets_ibfk_1;
ALTER TABLE voice_presets DROP COLUMN IF EXISTS user_id;


