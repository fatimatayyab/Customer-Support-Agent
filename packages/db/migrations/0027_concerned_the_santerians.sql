CREATE TYPE "public"."widget_position" AS ENUM('left', 'right');--> statement-breakpoint
CREATE TABLE "workspace_widget_settings" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"assistant_name" text,
	"greeting_message" text,
	"primary_color" text,
	"position" "widget_position" DEFAULT 'right' NOT NULL,
	"avatar_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_widget_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_widget_settings" ADD CONSTRAINT "workspace_widget_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "workspace_widget_settings_tenant_isolation" ON "workspace_widget_settings" AS PERMISSIVE FOR ALL TO public USING ("workspace_widget_settings"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("workspace_widget_settings"."workspace_id" = current_setting('app.workspace_id', true)::uuid);