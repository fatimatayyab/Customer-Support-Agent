CREATE TYPE "public"."conversation_rating_value" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TABLE "conversation_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"rating" "conversation_rating_value" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversation_ratings" ADD CONSTRAINT "conversation_ratings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_ratings" ADD CONSTRAINT "conversation_ratings_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_ratings_conversation_id_unique" ON "conversation_ratings" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "conversation_ratings_workspace_id_created_at_idx" ON "conversation_ratings" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE POLICY "conversation_ratings_tenant_isolation" ON "conversation_ratings" AS PERMISSIVE FOR ALL TO public USING ("conversation_ratings"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("conversation_ratings"."workspace_id" = current_setting('app.workspace_id', true)::uuid);