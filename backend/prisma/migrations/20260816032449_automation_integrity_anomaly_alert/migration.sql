-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'AUTOMATION_INTEGRITY_ANOMALY';

-- AlterTable
ALTER TABLE "automation_runs" ADD COLUMN     "anomaly_notified_at" TIMESTAMP(3);
