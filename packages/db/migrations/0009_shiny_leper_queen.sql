ALTER TABLE "integration_action_logs" DROP CONSTRAINT "integration_action_logs_integration_id_integrations_id_fk";
--> statement-breakpoint
ALTER TABLE "integration_action_logs" ALTER COLUMN "integration_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_action_logs" ADD CONSTRAINT "integration_action_logs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE set null ON UPDATE no action;