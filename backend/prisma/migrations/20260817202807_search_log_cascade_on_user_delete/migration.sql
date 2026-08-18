-- DropForeignKey
ALTER TABLE "search_logs" DROP CONSTRAINT "search_logs_requester_id_fkey";

-- AddForeignKey
ALTER TABLE "search_logs" ADD CONSTRAINT "search_logs_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
