CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`institution` text,
	`kind` text NOT NULL,
	`on_budget` integer DEFAULT true NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`opening_balance_cents` integer DEFAULT 0 NOT NULL,
	`opening_balance_date` text,
	`default_profile_id` text,
	`external_label` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`as_of_date` text NOT NULL,
	`balance_cents` integer NOT NULL,
	`source` text NOT NULL,
	`batch_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `snapshots_account_date_idx` ON `balance_snapshots` (`account_id`,`as_of_date`);--> statement-breakpoint
CREATE TABLE `batch_coverage` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`account_id` text NOT NULL,
	`coverage_start` text NOT NULL,
	`coverage_end` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `batch_coverage_account_idx` ON `batch_coverage` (`account_id`);--> statement-breakpoint
CREATE INDEX `batch_coverage_batch_idx` ON `batch_coverage` (`batch_id`);--> statement-breakpoint
CREATE TABLE `budget_targets` (
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`target_cents` integer NOT NULL,
	PRIMARY KEY(`category_id`, `month`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`flow` text NOT NULL,
	`spend_type` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `category_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`match_field` text NOT NULL,
	`match_type` text NOT NULL,
	`pattern` text NOT NULL,
	`amount_min_cents` integer,
	`amount_max_cents` integer,
	`account_id` text,
	`set_category_id` text NOT NULL,
	`set_payee_display` text,
	`enabled` integer DEFAULT true NOT NULL,
	`hit_count` integer DEFAULT 0 NOT NULL,
	`created_from_txn_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`profile_id` text,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`file_bytes` integer NOT NULL,
	`format` text,
	`row_count` integer DEFAULT 0 NOT NULL,
	`inserted_count` integer DEFAULT 0 NOT NULL,
	`exact_duplicate_count` integer DEFAULT 0 NOT NULL,
	`probable_duplicate_count` integer DEFAULT 0 NOT NULL,
	`pending_skipped_count` integer DEFAULT 0 NOT NULL,
	`issue_count` integer DEFAULT 0 NOT NULL,
	`coverage_start` text,
	`coverage_end` text,
	`status` text NOT NULL,
	`preview_json` text,
	`committed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_batches_sha_idx` ON `import_batches` (`file_sha256`);--> statement-breakpoint
CREATE TABLE `import_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`institution` text,
	`config_json` text,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `planned_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`date` text NOT NULL,
	`category_id` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_series` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`payee_key` text NOT NULL,
	`category_id` text,
	`cadence` text NOT NULL,
	`typical_amount_cents` integer NOT NULL,
	`amount_mad_cents` integer DEFAULT 0 NOT NULL,
	`anchor_day` integer,
	`last_seen_date` text NOT NULL,
	`next_expected_date` text NOT NULL,
	`status` text DEFAULT 'detected' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text,
	`amount_cents` integer NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `splits_txn_idx` ON `transaction_splits` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`posted_date` text NOT NULL,
	`txn_date` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`payee_raw` text NOT NULL,
	`memo_raw` text DEFAULT '' NOT NULL,
	`external_id` text,
	`fingerprint` text NOT NULL,
	`fingerprint_seq` integer NOT NULL,
	`payee_key` text NOT NULL,
	`payee_display` text NOT NULL,
	`category_id` text,
	`transfer_id` text,
	`is_reviewed` integer DEFAULT false NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `txn_fingerprint_idx` ON `transactions` (`account_id`,`fingerprint`,`fingerprint_seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `txn_external_idx` ON `transactions` (`account_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `txn_account_date_idx` ON `transactions` (`account_id`,`posted_date`);--> statement-breakpoint
CREATE INDEX `txn_category_date_idx` ON `transactions` (`category_id`,`posted_date`);--> statement-breakpoint
CREATE INDEX `txn_payee_key_idx` ON `transactions` (`payee_key`);--> statement-breakpoint
CREATE INDEX `txn_batch_idx` ON `transactions` (`batch_id`);--> statement-breakpoint
CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`from_txn_id` text NOT NULL,
	`to_txn_id` text NOT NULL,
	`confidence` real NOT NULL,
	`linked_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
