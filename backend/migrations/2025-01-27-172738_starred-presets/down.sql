ALTER TABLE voice_presets DROP COLUMN IF EXISTS is_featured;
ALTER TABLE wavetable_presets DROP COLUMN IF EXISTS is_featured;
ALTER TABLE synth_presets DROP COLUMN IF EXISTS is_featured;
ALTER TABLE subgraph_presets DROP COLUMN IF EXISTS is_featured;
ALTER TABLE midi_compositions DROP COLUMN IF EXISTS is_featured;
ALTER TABLE looper_presets DROP COLUMN IF EXISTS is_featured;

ALTER TABLE effects DROP COLUMN IF EXISTS is_featured;
ALTER TABLE compositions DROP COLUMN IF EXISTS is_featured;
