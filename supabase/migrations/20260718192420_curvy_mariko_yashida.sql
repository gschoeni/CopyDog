CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "api_keys_select_own" ON "api_keys" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("api_keys"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "api_keys_insert_own" ON "api_keys" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("api_keys"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "api_keys_update_own" ON "api_keys" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("api_keys"."user_id" = (select auth.uid())) WITH CHECK ("api_keys"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "api_keys_delete_own" ON "api_keys" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("api_keys"."user_id" = (select auth.uid()));