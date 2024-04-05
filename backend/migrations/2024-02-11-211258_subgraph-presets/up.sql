CREATE TABLE subgraph_presets (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  content LONGTEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE subgraph_preset_tags (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  subgraph_preset_id BIGINT NOT NULL REFERENCES subgraph_presets(id) ON DELETE CASCADE,
  tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (id)
);