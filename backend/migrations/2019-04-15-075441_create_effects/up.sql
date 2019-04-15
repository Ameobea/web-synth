-- Your SQL goes here
CREATE TABLE effects (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (id)
);
