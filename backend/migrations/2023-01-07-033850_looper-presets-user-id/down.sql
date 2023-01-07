ALTER TABLE looper_presets DROP FOREIGN KEY IF EXISTS looper_presets_ibfk_1;
ALTER TABLE looper_presets DROP COLUMN IF EXISTS user_id;
ALTER TABLE looper_presets ADD COLUMN IF NOT EXISTS author bigint(20);
