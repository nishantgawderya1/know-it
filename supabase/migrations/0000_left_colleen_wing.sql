CREATE TYPE "public"."audit_strategy" AS ENUM('index_diff', 'calendar_expect', 'proxy_sample', 'none');--> statement-breakpoint
CREATE TYPE "public"."coverage_status" AS ENUM('ok', 'gap', 'error');--> statement-breakpoint
CREATE TYPE "public"."extraction_status" AS ENUM('pending', 'ok', 'partial', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."fetch_type" AS ENUM('rss', 'atom', 'scrape', 'hn', 'github_api', 'json_api');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('news', 'data');--> statement-breakpoint
CREATE TYPE "public"."source_role" AS ENUM('record', 'discovery');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('regulator', 'exchange', 'industry_body', 'outlet', 'wire', 'analyst_blog', 'company_blog', 'code_release', 'community');--> statement-breakpoint
CREATE TYPE "public"."timestamp_confidence" AS ENUM('high', 'low', 'suspect');--> statement-breakpoint
CREATE TYPE "public"."vertical" AS ENUM('finance', 'tech');--> statement-breakpoint
CREATE TYPE "public"."wire_evidence" AS ENUM('byline', 'dateline', 'mention');--> statement-breakpoint
CREATE TABLE "coverage_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"vertical" "vertical" NOT NULL,
	"audit_date" text NOT NULL,
	"strategy" "audit_strategy" NOT NULL,
	"expected_count" integer,
	"ingested_count" integer,
	"missing_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "coverage_status" NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"http_status" integer,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "raw_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"vertical" "vertical" NOT NULL,
	"url" text NOT NULL,
	"url_raw" text NOT NULL,
	"title" text,
	"text_content" text,
	"html_snapshot" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"published_at_confidence" timestamp_confidence NOT NULL,
	"published_at_reason" text,
	"extraction_status" "extraction_status" DEFAULT 'pending' NOT NULL,
	"extraction_error" text,
	"origin_primary_links" text[] DEFAULT '{}'::text[] NOT NULL,
	"origin_wire_byline" text,
	"origin_wire_evidence" "wire_evidence",
	"origin_has_verbatim_quote" boolean DEFAULT false NOT NULL,
	"origin_discovery_target_url" text,
	"is_processed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"error_type" text NOT NULL,
	"message" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"vertical" "vertical" NOT NULL,
	"source_kind" "source_kind" DEFAULT 'news' NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_role" "source_role" DEFAULT 'record' NOT NULL,
	"feed_url" text NOT NULL,
	"fetch_type" "fetch_type" NOT NULL,
	"user_agent" text,
	"index_url" text,
	"audit_strategy" "audit_strategy" DEFAULT 'none' NOT NULL,
	"active_hours_tz" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"active_start_hour" integer DEFAULT 0 NOT NULL,
	"active_end_hour" integer DEFAULT 24 NOT NULL,
	"active_interval_min" integer DEFAULT 15 NOT NULL,
	"off_interval_min" integer DEFAULT 120 NOT NULL,
	"next_fetch_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_etag" text,
	"last_modified" text,
	"feed_window_size" integer,
	"reliability_weight" real DEFAULT 0.7 NOT NULL,
	"is_full_text" boolean,
	"is_active" boolean DEFAULT true NOT NULL,
	"topics" text[] DEFAULT '{}'::text[] NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "coverage_audit" ADD CONSTRAINT "coverage_audit_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_log" ADD CONSTRAINT "fetch_log_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_errors" ADD CONSTRAINT "source_errors_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coverage_audit_source_date_key" ON "coverage_audit" USING btree ("source_id","audit_date");--> statement-breakpoint
CREATE INDEX "coverage_audit_date_idx" ON "coverage_audit" USING btree ("audit_date");--> statement-breakpoint
CREATE INDEX "fetch_log_source_time_idx" ON "fetch_log" USING btree ("source_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_documents_url_key" ON "raw_documents" USING btree ("url");--> statement-breakpoint
CREATE INDEX "raw_documents_vertical_fetched_idx" ON "raw_documents" USING btree ("vertical","fetched_at");--> statement-breakpoint
CREATE INDEX "raw_documents_source_fetched_idx" ON "raw_documents" USING btree ("source_id","fetched_at");--> statement-breakpoint
CREATE INDEX "raw_documents_unprocessed_idx" ON "raw_documents" USING btree ("fetched_at") WHERE NOT "raw_documents"."is_processed";--> statement-breakpoint
CREATE INDEX "source_errors_open_idx" ON "source_errors" USING btree ("source_id","occurred_at") WHERE "source_errors"."resolved_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sources_slug_key" ON "sources" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "sources_due_idx" ON "sources" USING btree ("next_fetch_at") WHERE "sources"."is_active" AND "sources"."source_kind" = 'news';--> statement-breakpoint
CREATE INDEX "sources_vertical_idx" ON "sources" USING btree ("vertical");