-- DropForeignKey
ALTER TABLE "ticket_status_history" DROP CONSTRAINT "ticket_status_history_changed_by_fkey";

-- AlterTable
ALTER TABLE "ticket_status_history" ALTER COLUMN "changed_by" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "ticket_status_history" ADD CONSTRAINT "ticket_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
