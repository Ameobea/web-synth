CREATE TABLE midi_compositions_tags (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  midi_composition_id BIGINT NOT NULL REFERENCES midi_compositions(id),
  tag_id BIGINT NOT NULL REFERENCES tags(id)
);
