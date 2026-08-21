CREATE TYPE "public"."image_source" AS ENUM('media_content', 'media_thumbnail', 'enclosure', 'content_img', 'og', 'twitter', 'inline');--> statement-breakpoint
ALTER TABLE "fetch_log" ADD COLUMN "items_with_image" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD COLUMN "image_source" "image_source";--> statement-breakpoint
ALTER TABLE "raw_documents" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD COLUMN "image_height" integer;