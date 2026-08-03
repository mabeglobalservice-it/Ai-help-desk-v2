-- CreateEnum
CREATE TYPE "AutoResolutionStatus" AS ENUM ('RESOLVED', 'FAILED_FALLBACK');

-- AlterTable
ALTER TABLE "knowledge_articles" ADD COLUMN     "auto_resolution_id" TEXT,
ALTER COLUMN "ticket_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "auto_resolutions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "script_id" TEXT NOT NULL,
    "confidence_score" DECIMAL(4,3) NOT NULL,
    "status" "AutoResolutionStatus" NOT NULL DEFAULT 'RESOLVED',
    "output_log" TEXT,
    "fallback_ticket_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_resolutions_fallback_ticket_id_key" ON "auto_resolutions"("fallback_ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_articles_auto_resolution_id_key" ON "knowledge_articles"("auto_resolution_id");

-- AddForeignKey
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_auto_resolution_id_fkey" FOREIGN KEY ("auto_resolution_id") REFERENCES "auto_resolutions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_resolutions" ADD CONSTRAINT "auto_resolutions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_resolutions" ADD CONSTRAINT "auto_resolutions_script_id_fkey" FOREIGN KEY ("script_id") REFERENCES "scripts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_resolutions" ADD CONSTRAINT "auto_resolutions_fallback_ticket_id_fkey" FOREIGN KEY ("fallback_ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
