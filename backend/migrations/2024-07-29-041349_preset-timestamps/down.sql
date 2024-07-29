ALTER TABLE voice_presets DROP COLUMN IF EXISTS created_at;
ALTER TABLE wavetable_presets DROP COLUMN IF EXISTS created_at;
ALTER TABLE synth_presets DROP COLUMN IF EXISTS created_at;
ALTER TABLE subgraph_presets DROP COLUMN IF EXISTS created_at;
ALTER TABLE midi_compositions DROP COLUMN IF EXISTS created_at;
ALTER TABLE looper_presets DROP COLUMN IF EXISTS created_at;
