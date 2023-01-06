CREATE TABLE IF NOT EXISTS private_sample_libraries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  bucket_name TEXT NOT NULL,
  region_json TEXT NOT NULL,
  public_url_base TEXT NOT NULL,
  access_key_id TEXT NOT NULL,
  secret_access_key TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX private_sample_libraries_user_id (user_id)
);
