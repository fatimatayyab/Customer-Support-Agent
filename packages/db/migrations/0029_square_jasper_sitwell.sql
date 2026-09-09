CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_reset_tokens_workspace_id_idx" ON "password_reset_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_unique" ON "password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE POLICY "password_reset_tokens_tenant_isolation" ON "password_reset_tokens" AS PERMISSIVE FOR ALL TO public USING ("password_reset_tokens"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("password_reset_tokens"."workspace_id" = current_setting('app.workspace_id', true)::uuid);--> statement-breakpoint
-- auth_resolver resolves a reset token into its workspace/user before any
-- tenant context exists (the public reset flow), the same pattern as the
-- invitation grants - column-level SELECT on exactly the columns the
-- lookup reads/filters, including token_hash for the WHERE clause
-- (Postgres requires column privilege for WHERE references too - the
-- lesson 0011/0012 taught for invitations).
GRANT SELECT (id, workspace_id, user_id, token_hash, expires_at, used_at) ON password_reset_tokens TO auth_resolver;