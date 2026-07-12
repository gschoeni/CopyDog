CREATE TYPE "public"."project_role" AS ENUM('owner', 'editor');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"oxen_repo" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_oxen_repo_unique" UNIQUE("oxen_repo")
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_members" (
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "project_role" DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "project_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_profiles_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "profiles_select_authenticated" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "profiles_update_own" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "profiles"."id") WITH CHECK ((select auth.uid()) = "profiles"."id");--> statement-breakpoint
CREATE POLICY "projects_select_members" ON "projects" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_project_member("projects"."id"));--> statement-breakpoint
CREATE POLICY "projects_update_owner" ON "projects" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("projects"."owner_id" = (select auth.uid())) WITH CHECK ("projects"."owner_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "projects_delete_owner" ON "projects" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("projects"."owner_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "project_members_select_members" ON "project_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING (public.is_project_member("project_members"."project_id"));--> statement-breakpoint
CREATE POLICY "project_members_insert_owner" ON "project_members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (public.is_project_owner("project_members"."project_id"));--> statement-breakpoint
CREATE POLICY "project_members_delete_owner_or_self" ON "project_members" AS PERMISSIVE FOR DELETE TO "authenticated" USING (public.is_project_owner("project_members"."project_id") or "project_members"."user_id" = (select auth.uid()));