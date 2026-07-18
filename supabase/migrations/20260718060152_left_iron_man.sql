ALTER TABLE "chat_messages" ADD COLUMN "conversation_id" uuid;

CREATE TEMPORARY TABLE "chat_message_thread_migration" AS
SELECT "project_id", "user_id", "page_slug", gen_random_uuid() AS "conversation_id"
FROM "chat_messages"
GROUP BY "project_id", "user_id", "page_slug";

UPDATE "chat_messages" AS "message"
SET "conversation_id" = "thread"."conversation_id"
FROM "chat_message_thread_migration" AS "thread"
WHERE "message"."project_id" = "thread"."project_id"
  AND "message"."user_id" = "thread"."user_id"
  AND "message"."page_slug" = "thread"."page_slug";

DROP TABLE "chat_message_thread_migration";
ALTER TABLE "chat_messages" ALTER COLUMN "conversation_id" SET NOT NULL;
