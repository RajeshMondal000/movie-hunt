CREATE TABLE `rate_limit_counters` (
	`bucket_key` text NOT NULL,
	`window_key` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`bucket_key`, `window_key`)
);
--> statement-breakpoint
CREATE INDEX `rate_limit_counters_expires_at_idx` ON `rate_limit_counters` (`expires_at`);