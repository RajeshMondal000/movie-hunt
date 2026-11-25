CREATE TABLE `anime_catalog` (
	`kitsu_id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`synopsis` text DEFAULT '' NOT NULL,
	`poster_url` text,
	`cover_url` text,
	`average_rating` real DEFAULT 0 NOT NULL,
	`start_date` text,
	`episode_count` integer,
	`episode_length` integer,
	`subtype` text,
	`status` text,
	`age_rating` text,
	`genres_json` text DEFAULT '[]' NOT NULL,
	`user_count` integer DEFAULT 0 NOT NULL,
	`youtube_video_id` text,
	`slug` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `anime_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`anime_id` text NOT NULL,
	`rating` real NOT NULL,
	`review` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anime_id`) REFERENCES `anime_catalog`(`kitsu_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anime_reviews_user_anime_unique` ON `anime_reviews` (`user_id`,`anime_id`);--> statement-breakpoint
CREATE INDEX `anime_reviews_anime_idx` ON `anime_reviews` (`anime_id`);--> statement-breakpoint
CREATE TABLE `anime_watchlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`anime_id` text NOT NULL,
	`status` text DEFAULT 'want_to_watch' NOT NULL,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`watched_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anime_id`) REFERENCES `anime_catalog`(`kitsu_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `anime_watchlist_user_anime_unique` ON `anime_watchlist_items` (`user_id`,`anime_id`);--> statement-breakpoint
CREATE INDEX `anime_watchlist_user_status_idx` ON `anime_watchlist_items` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `anime_watchlist_anime_idx` ON `anime_watchlist_items` (`anime_id`);