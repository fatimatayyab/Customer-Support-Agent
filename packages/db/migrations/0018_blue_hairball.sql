CREATE TABLE "conversation_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"escalated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_escalations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_escalations" ADD CONSTRAINT "conversation_escalations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_escalations" ADD CONSTRAINT "conversation_escalations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_escalations_workspace_id_conversation_id_idx" ON "conversation_escalations" USING btree ("workspace_id","conversation_id");--> statement-breakpoint
CREATE POLICY "conversation_escalations_tenant_isolation" ON "conversation_escalations" AS PERMISSIVE FOR ALL TO public USING ("conversation_escalations"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("conversation_escalations"."workspace_id" = current_setting('app.workspace_id', true)::uuid);