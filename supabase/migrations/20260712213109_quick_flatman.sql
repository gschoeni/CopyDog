CREATE TYPE "public"."proposal_status" AS ENUM('open', 'merged', 'closed');--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source_branch" text NOT NULL,
	"base_commit" text NOT NULL,
	"status" "proposal_status" DEFAULT 'open' NOT NULL,
	"merged_commit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "section_versions" (
	"project_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"page_slug" text NOT NULL,
	"section_slug" text NOT NULL,
	"version_slug" text NOT NULL,
	"label" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_versions_project_id_author_id_page_slug_section_slug_version_slug_pk" PRIMARY KEY("project_id","author_id","page_slug","section_slug","version_slug")
);
--> statement-breakpoint
ALTER TABLE "section_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "proposals_select_members" ON "proposals" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_project_member("proposals"."project_id"));--> statement-breakpoint
CREATE POLICY "proposals_insert_members_as_self" ON "proposals" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.is_project_member("proposals"."project_id") and "proposals"."author_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "proposals_update_members" ON "proposals" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (public.is_project_member("proposals"."project_id")) WITH CHECK (public.is_project_member("proposals"."project_id"));--> statement-breakpoint
CREATE POLICY "section_versions_select_members" ON "section_versions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_project_member("section_versions"."project_id"));--> statement-breakpoint
CREATE POLICY "section_versions_insert_own" ON "section_versions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.is_project_member("section_versions"."project_id") and "section_versions"."author_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "section_versions_update_own" ON "section_versions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("section_versions"."author_id" = (select auth.uid())) WITH CHECK ("section_versions"."author_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "section_versions_delete_own" ON "section_versions" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("section_versions"."author_id" = (select auth.uid()));