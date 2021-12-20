DROP TABLE IF EXISTS compositions_tags;

CREATE TABLE composition_tags (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  tag TEXT NOT NULL,
  PRIMARY KEY (id)
);

/* Lists all composition->tag associations */
CREATE TABLE composition_tags_join (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  tag BIGINT NOT NULL,
  composition BIGINT NOT NULL,
  PRIMARY KEY (id)
);
