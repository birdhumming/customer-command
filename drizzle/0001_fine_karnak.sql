CREATE TABLE `demo_reset_account_backups` (
	`reset_revision` text NOT NULL,
	`account_id` text NOT NULL,
	`account_version` integer NOT NULL,
	`payload` text NOT NULL,
	`backed_up_at` text NOT NULL,
	PRIMARY KEY(`reset_revision`, `account_id`)
);
--> statement-breakpoint
CREATE TABLE `demo_reset_runs` (
	`revision` text PRIMARY KEY NOT NULL,
	`executed_at` text NOT NULL
);
