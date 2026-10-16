CREATE TABLE "calendar_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "calendar_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"client_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"institution_code" text NOT NULL,
	"service_code" text NOT NULL,
	"schedule_hash" text NOT NULL,
	"reserved_hash" text NOT NULL,
	"schedule" jsonb NOT NULL,
	"reserved" jsonb NOT NULL,
	"app_version" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_snapshots_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE INDEX "calendar_snapshots_scope_id_idx" ON "calendar_snapshots" USING btree ("institution_code","service_code","id");--> statement-breakpoint
CREATE INDEX "calendar_snapshots_observed_at_idx" ON "calendar_snapshots" USING btree ("observed_at");