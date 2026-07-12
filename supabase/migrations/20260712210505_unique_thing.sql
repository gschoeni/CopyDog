CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"page_slug" text NOT NULL,
	"section_slug" text NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "comments_select_members" ON "comments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_project_member("comments"."project_id"));--> statement-breakpoint
CREATE POLICY "comments_insert_members_as_self" ON "comments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.is_project_member("comments"."project_id") and "comments"."author_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "comments_update_members" ON "comments" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.is_project_member("comments"."project_id")) WITH CHECK (public.is_project_member("comments"."project_id"));--> statement-breakpoint
CREATE POLICY "comments_delete_author" ON "comments" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("comments"."author_id" = (select auth.uid()));