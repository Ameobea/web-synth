DROP TABLE IF EXISTS composition_tags_join;
DROP TABLE IF EXISTS composition_tags;

CREATE TABLE compositions_tags (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  composition_id BIGINT NOT NULL REFERENCES compositions(id),
  tag_id BIGINT NOT NULL REFERENCES tags(id)
);
