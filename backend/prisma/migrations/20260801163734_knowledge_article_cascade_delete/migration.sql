-- DropForeignKey
ALTER TABLE "knowledge_articles" DROP CONSTRAINT "knowledge_articles_ticket_id_fkey";

-- AddForeignKey
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
