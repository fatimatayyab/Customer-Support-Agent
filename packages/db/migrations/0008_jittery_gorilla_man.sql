CREATE TYPE "public"."integration_provider" AS ENUM('hubspot');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('connected', 'error', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."integration_action_result" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"credentials" text NOT NULL,
	"status" "integration_status" DEFAULT 'connected' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integration_action_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"integration_id" uuid NOT NULL,
	"conversation_id" uuid,
	"action_name" text NOT NULL,
	"request_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result_status" "integration_action_result" NOT NULL,
	"result_summary" text NOT NULL,
	"triggered_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integration_action_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_action_logs" ADD CONSTRAINT "integration_action_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_action_logs" ADD CONSTRAINT "integration_action_logs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_action_logs" ADD CONSTRAINT "integration_action_logs_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_action_logs" ADD CONSTRAINT "integration_action_logs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "integrations_workspace_id_idx" ON "integrations" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_workspace_id_provider_unique" ON "integrations" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "integration_action_logs_workspace_id_idx" ON "integration_action_logs" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "integration_action_logs_workspace_id_conversation_id_idx" ON "integration_action_logs" USING btree ("workspace_id","conversation_id");--> statement-breakpoint
CREATE POLICY "integrations_tenant_isolation" ON "integrations" AS PERMISSIVE FOR ALL TO public USING ("integrations"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("integrations"."workspace_id" = current_setting('app.workspace_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "integration_action_logs_tenant_isolation" ON "integration_action_logs" AS PERMISSIVE FOR ALL TO public USING ("integration_action_logs"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("integration_action_logs"."workspace_id" = current_setting('app.workspace_id', true)::uuid);