ALTER TABLE voice_presets ADD COLUMN IF NOT EXISTS is_featured BOOL NOT NULL DEFAULT false;
ALTER TABLE wavetable_presets ADD COLUMN IF NOT EXISTS is_featured BOOL NOT NULL DEFAULT false;
ALTER TABLE synth_presets ADD COLUMN IF NOT EXISTS is_featured BOOL NOT NULL DEFAULT false;
ALTER TABLE subgraph_presets ADD COLUMN IF NOT EXISTS is_featured BOOL NOT NULL DEFAULT false;
ALTER TABLE midi_compositions ADD COLUMN IF NOT EXISTS is_featured BOOL NOT NULL DEFAULT false;
ALTER TABLE looper_presets ADD COLUMN IF NOT EXISTS is_featured BOOL NOT NULL DEFAULT false;

ALTER TABLE effects ADD COLUMN IF NOT EXISTS is_featured BOOL NOT NULL DEFAULT false;
ALTER TABLE compositions ADD COLUMN IF NOT EXISTS is_featured BOOL NOT NULL DEFAULT false;
