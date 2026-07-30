CREATE TYPE "public"."workspace_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'administrator', 'support_agent');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('invited', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "workspace_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "workspace_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_workspace_email_unique" ON "users" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_api_keys_hash_unique" ON "workspace_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE POLICY "workspaces_select_own" ON "workspaces" AS PERMISSIVE FOR SELECT TO public USING ("workspaces"."id" = current_setting('app.workspace_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "workspaces_update_own" ON "workspaces" AS PERMISSIVE FOR UPDATE TO public USING ("workspaces"."id" = current_setting('app.workspace_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "workspaces_insert" ON "workspaces" AS PERMISSIVE FOR INSERT TO public WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "users_tenant_isolation" ON "users" AS PERMISSIVE FOR ALL TO public USING ("users"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("users"."workspace_id" = current_setting('app.workspace_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "workspace_api_keys_tenant_isolation" ON "workspace_api_keys" AS PERMISSIVE FOR ALL TO public USING ("workspace_api_keys"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("workspace_api_keys"."workspace_id" = current_setting('app.workspace_id', true)::uuid);