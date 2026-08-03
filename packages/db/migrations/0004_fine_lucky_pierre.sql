CREATE INDEX "workspace_api_keys_workspace_id_idx" ON "workspace_api_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "customers_workspace_id_idx" ON "customers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "conversations_workspace_id_idx" ON "conversations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "messages_workspace_id_idx" ON "messages" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_sources_workspace_id_created_at_idx" ON "knowledge_sources" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_workspace_id_idx" ON "knowledge_chunks" USING btree ("workspace_id");