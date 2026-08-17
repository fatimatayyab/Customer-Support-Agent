CREATE TABLE "workspace_platform_meta" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"plan" text,
	"billing_notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_platform_meta" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_platform_meta" ADD CONSTRAINT "workspace_platform_meta_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;