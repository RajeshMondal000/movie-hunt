CREATE TABLE `user_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`movie_id` integer NOT NULL,
	`rating` real NOT NULL,
	`review` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_reviews_user_movie_unique` ON `user_reviews` (`user_id`,`movie_id`);--> statement-breakpoint
CREATE INDEX `user_reviews_movie_idx` ON `user_reviews` (`movie_id`);--> statement-breakpoint
CREATE TABLE `watchlist_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`movie_id` integer NOT NULL,
	`status` text DEFAULT 'want_to_watch' NOT NULL,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`watched_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_user_movie_unique` ON `watchlist_items` (`user_id`,`movie_id`);--> statement-breakpoint
CREATE INDEX `watchlist_user_status_idx` ON `watchlist_items` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `watchlist_movie_idx` ON `watchlist_items` (`movie_id`);