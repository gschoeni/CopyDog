CREATE TYPE "public"."chat_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"page_slug" text NOT NULL,
	"role" "chat_role" NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "chat_messages_select_own" ON "chat_messages" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("chat_messages"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "chat_messages_insert_own" ON "chat_messages" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("chat_messages"."user_id" = (select auth.uid()) and public.is_project_member("chat_messages"."project_id"));--> statement-breakpoint
CREATE POLICY "chat_messages_delete_own" ON "chat_messages" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("chat_messages"."user_id" = (select auth.uid()));