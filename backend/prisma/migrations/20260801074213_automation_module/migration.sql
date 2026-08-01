-- CreateEnum
CREATE TYPE "ScriptLanguage" AS ENUM ('POWERSHELL', 'CMD', 'BASH', 'PYTHON');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING_APPROVAL', 'RUNNING', 'SUCCESS', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'APPROVAL_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'AUTOMATION_DECIDED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "can_approve_automations" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "scripts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" "ScriptLanguage" NOT NULL,
    "content" TEXT NOT NULL,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "script_id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "ci_id" TEXT,
    "requested_by_id" TEXT NOT NULL,
    "executed_by_id" TEXT,
    "justification" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "output_log" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "automation_run_id" TEXT NOT NULL,
    "approved_by" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_runs_status_requested_by_id_idx" ON "automation_runs"("status", "requested_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_automation_run_id_key" ON "approvals"("automation_run_id");

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_ci_id_fkey" FOREIGN KEY ("ci_id") REFERENCES "configuration_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_executed_by_id_fkey" FOREIGN KEY ("executed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_automation_run_id_fkey" FOREIGN KEY ("automation_run_id") REFERENCES "automation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
