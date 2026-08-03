CREATE TYPE "public"."knowledge_source_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_source_type" AS ENUM('website', 'pdf', 'docx', 'faq', 'plain_text');--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" "knowledge_source_type" NOT NULL,
	"title" text NOT NULL,
	"source_location" text,
	"content" text,
	"status" "knowledge_source_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"knowledge_source_id" uuid NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(512) NOT NULL,
	"chunk_order" integer NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_knowledge_source_id_knowledge_sources_id_fk" FOREIGN KEY ("knowledge_source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE POLICY "knowledge_sources_tenant_isolation" ON "knowledge_sources" AS PERMISSIVE FOR ALL TO public USING ("knowledge_sources"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("knowledge_sources"."workspace_id" = current_setting('app.workspace_id', true)::uuid);--> statement-breakpoint
CREATE POLICY "knowledge_chunks_tenant_isolation" ON "knowledge_chunks" AS PERMISSIVE FOR ALL TO public USING ("knowledge_chunks"."workspace_id" = current_setting('app.workspace_id', true)::uuid) WITH CHECK ("knowledge_chunks"."workspace_id" = current_setting('app.workspace_id', true)::uuid);