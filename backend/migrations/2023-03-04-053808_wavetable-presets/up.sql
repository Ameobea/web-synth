CREATE TABLE wavetable_presets (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  serialized_wavetable_inst_state LONGTEXT NOT NULL,
  user_id BIGINT REFERENCES users(id)
);
CREATE INDEX wavetable_presets_user_id ON wavetable_presets(user_id);

CREATE TABLE wavetable_presets_tags (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  wavetable_preset_id BIGINT NOT NULL REFERENCES wavetable_presets(id),
  tag_id BIGINT NOT NULL REFERENCES tags(id)
);
