-- CreateEnum
CREATE TYPE "AiConversationStatus" AS ENUM ('ONGOING', 'RESOLVED', 'ESCALATED');

-- AlterTable
ALTER TABLE "ai_conversations" ADD COLUMN     "status" "AiConversationStatus" NOT NULL DEFAULT 'ONGOING';
