CREATE TABLE looper_presets (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  author BIGINT REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  serialized_looper_inst_state LONGTEXT NOT NULL
);

CREATE TABLE tags (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tag TEXT UNIQUE NOT NULL
);
CREATE INDEX tags_tag_idx ON tags(tag);

CREATE TABLE looper_presets_tags (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  looper_preset_id BIGINT NOT NULL REFERENCES looper_presets(id),
  tag_id BIGINT NOT NULL REFERENCES tags(id)
);
