CREATE TYPE "public"."escalation_contact_method" AS ENUM('email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."escalation_contact_sync_status" AS ENUM('pending', 'synced', 'failed');--> statement-breakpoint
CREATE TABLE "conversation_escalation_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_method" "escalation_contact_method" NOT NULL,
	"contact_value" text NOT NULL,
	"escalation_reason" text NOT NULL,
	"escalation_detail" text DEFAULT '' NOT NULL,
	"airtable_sync_status" "escalation_contact_sync_status" DEFAULT 'pending' NOT NULL,
	"airtable_record_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_escalation_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_escalation_contacts" ADD CONSTRAINT "conversation_escalation_contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_escalation_contacts" ADD CONSTRAINT "conversation_escalation_contacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_escalation_contacts_conversation_id_unique" ON "conversation_escalation_contacts" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_escalation_contacts_workspace_id_created_at_idx" ON "conversation_escalation_contacts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE POLICY "conversation_escalation_contacts_tenant_isolation" ON "conversation_escalation_contacts" AS PERMISSIVE FOR ALL TO public USING ("conversation_escalation_contacts"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("conversation_escalation_contacts"."workspace_id" = current_setting('app.workspace_id', true)::uuid);