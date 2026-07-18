ALTER TABLE "api_key_rate" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "mcp_audit_log_project_created_idx" ON "mcp_audit_log" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "mcp_audit_log_api_key_idx" ON "mcp_audit_log" USING btree ("api_key_id");--> statement-breakpoint
CREATE INDEX "mcp_audit_log_user_idx" ON "mcp_audit_log" USING btree ("user_id");