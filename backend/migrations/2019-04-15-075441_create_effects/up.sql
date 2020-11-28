CREATE TABLE effects (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  code TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE users (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  username TEXT NOT NULL,
  hashed_password TEXT NOT NULL,
  last_login TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
);

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

ALTER TABLE `composition_tags_join` ADD UNIQUE `unique_index`(`tag`, `composition`);

CREATE TABLE compositions (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  author BIGINT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  content LONGTEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE voice_presets (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body LONGTEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE synth_presets (
  id BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (id)
);
