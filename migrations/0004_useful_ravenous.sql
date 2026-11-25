CREATE TABLE `friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_a_id` text NOT NULL,
	`user_b_id` text NOT NULL,
	`requested_by_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_a_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_b_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friendships_user_pair_unique` ON `friendships` (`user_a_id`,`user_b_id`);--> statement-breakpoint
CREATE INDEX `friendships_user_a_status_idx` ON `friendships` (`user_a_id`,`status`);--> statement-breakpoint
CREATE INDEX `friendships_user_b_status_idx` ON `friendships` (`user_b_id`,`status`);--> statement-breakpoint
CREATE INDEX `friendships_requested_by_idx` ON `friendships` (`requested_by_id`);--> statement-breakpoint
CREATE TABLE `shared_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`sender_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`media_type` text NOT NULL,
	`media_id` text NOT NULL,
	`title` text NOT NULL,
	`poster_url` text,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`sender_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shared_recommendations_recipient_created_idx` ON `shared_recommendations` (`recipient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `shared_recommendations_sender_idx` ON `shared_recommendations` (`sender_id`);--> statement-breakpoint
CREATE TABLE `social_privacy` (
	`user_id` text PRIMARY KEY NOT NULL,
	`share_activity` integer DEFAULT false NOT NULL,
	`allow_friend_requests` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
