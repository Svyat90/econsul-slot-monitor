CREATE TYPE "public"."check_kind" AS ENUM('scheduled', 'fast', 'manual');--> statement-breakpoint
CREATE TYPE "public"."request_outcome" AS ENUM('ok', 'session_expired', 'unavailable', 'schema_error', 'network_error');--> statement-breakpoint
CREATE TYPE "public"."reservation_kind" AS ENUM('reserved', 'released');--> statement-breakpoint
CREATE TYPE "public"."schedule_change_type" AS ENUM('baseline', 'changed');--> statement-breakpoint
CREATE TABLE "econsul_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "econsul_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"service" text NOT NULL,
	"method" text NOT NULL,
	"institution_code" text,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"http_status" smallint,
	"outcome" "request_outcome" NOT NULL,
	"items_count" integer,
	"response_bytes" integer,
	"check_kind" "check_kind",
	"check_seq" integer,
	"source" text NOT NULL,
	"tab_session_id" uuid NOT NULL,
	"app_version" text NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "econsul_requests_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "econsul_requests_status_matches_outcome" CHECK (("econsul_requests"."outcome" = 'network_error') = ("econsul_requests"."http_status" IS NULL)),
	CONSTRAINT "econsul_requests_source" CHECK ("econsul_requests"."source" IN ('app', 'extension'))
);
--> statement-breakpoint
CREATE TABLE "monitor_checks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "monitor_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"kind" "check_kind" NOT NULL,
	"check_seq" integer NOT NULL,
	"institution_code" text NOT NULL,
	"service_code" text NOT NULL,
	"outcome" "request_outcome" NOT NULL,
	"free_count" integer,
	"new_count" integer,
	"out_of_range_count" integer,
	"new_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tab_session_id" uuid NOT NULL,
	"app_version" text NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitor_checks_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "monitor_checks_counts_when_ok" CHECK ("monitor_checks"."outcome" <> 'ok' OR "monitor_checks"."free_count" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "reservation_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reservation_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" uuid NOT NULL,
	"kind" "reservation_kind" NOT NULL,
	"institution_code" text NOT NULL,
	"consul_ipn_hash" text NOT NULL,
	"slot_from" timestamp with time zone NOT NULL,
	"slot_to" timestamp with time zone NOT NULL,
	"previous_check_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"tab_session_id" uuid NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_events_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "schedule_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "schedule_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" uuid NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"institution_code" text NOT NULL,
	"institution" text NOT NULL,
	"type" "schedule_change_type" NOT NULL,
	"previous_check_at" timestamp with time zone,
	"changes" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_changes_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "extension_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "extension_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"job_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"extension_version" text NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_events_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE INDEX "econsul_requests_started_at_idx" ON "econsul_requests" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "econsul_requests_method_started_at_idx" ON "econsul_requests" USING btree ("method","started_at");--> statement-breakpoint
CREATE INDEX "econsul_requests_failures_idx" ON "econsul_requests" USING btree ("started_at") WHERE "econsul_requests"."outcome" <> 'ok';--> statement-breakpoint
CREATE INDEX "monitor_checks_started_at_idx" ON "monitor_checks" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "monitor_checks_institution_started_at_idx" ON "monitor_checks" USING btree ("institution_code","started_at");--> statement-breakpoint
CREATE INDEX "reservation_events_detected_at_idx" ON "reservation_events" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "reservation_events_institution_slot_idx" ON "reservation_events" USING btree ("institution_code","slot_from");--> statement-breakpoint
CREATE INDEX "schedule_changes_checked_at_idx" ON "schedule_changes" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "schedule_changes_institution_checked_at_idx" ON "schedule_changes" USING btree ("institution_code","checked_at");--> statement-breakpoint
CREATE INDEX "extension_events_occurred_at_idx" ON "extension_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "extension_events_job_idx" ON "extension_events" USING btree ("job_id") WHERE "extension_events"."job_id" IS NOT NULL;