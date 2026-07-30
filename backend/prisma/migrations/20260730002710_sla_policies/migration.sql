-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SLA_BREACHED';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "sla_breach_notified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "priority_id" TEXT NOT NULL,
    "resolution_hours" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_priority_id_key" ON "sla_policies"("priority_id");

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_priority_id_fkey" FOREIGN KEY ("priority_id") REFERENCES "priorities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
