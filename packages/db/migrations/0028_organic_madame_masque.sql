CREATE TYPE "public"."integration_action_trigger" AS ENUM('human', 'ai');--> statement-breakpoint
ALTER TABLE "integration_action_logs" ALTER COLUMN "triggered_by_user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_action_logs" ADD COLUMN "triggered_by" "integration_action_trigger" NOT NULL DEFAULT 'human';--> statement-breakpoint
ALTER TABLE "integration_action_logs" ALTER COLUMN "triggered_by" DROP DEFAULT;