ALTER TABLE `users` ADD INDEX IF NOT EXISTS `id` (`id`);

ALTER TABLE `users` DROP INDEX IF EXISTS `uniq_username`;

DROP TABLE IF EXISTS login_tokens;
