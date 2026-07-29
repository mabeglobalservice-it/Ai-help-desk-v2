/*
  Warnings:

  - The `from_status` column on the `ticket_status_history` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `to_status` on the `ticket_status_history` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "ticket_status_history" DROP COLUMN "from_status",
ADD COLUMN     "from_status" "TicketStatus",
DROP COLUMN "to_status",
ADD COLUMN     "to_status" "TicketStatus" NOT NULL;

-- CreateIndex
CREATE INDEX "ticket_status_history_ticket_id_changed_at_idx" ON "ticket_status_history"("ticket_id", "changed_at");

-- AddForeignKey
ALTER TABLE "ticket_status_history" ADD CONSTRAINT "ticket_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
