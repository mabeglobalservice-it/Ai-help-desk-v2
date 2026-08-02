-- CreateEnum
CREATE TYPE "AiAgentName" AS ENUM ('DIAGNOSTIC', 'DOCUMENTATION', 'AUTOMATION', 'SUPERVISOR', 'INVENTORY', 'HELPDESK');

-- CreateEnum
CREATE TYPE "AiProviderName" AS ENUM ('CLAUDE', 'OPENAI', 'AZURE_OPENAI');

-- CreateTable
CREATE TABLE "ai_agents" (
    "id" TEXT NOT NULL,
    "name" "AiAgentName" NOT NULL,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_provider_configs" (
    "id" TEXT NOT NULL,
    "provider" "AiProviderName" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_agents_name_key" ON "ai_agents"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_configs_provider_key" ON "ai_provider_configs"("provider");
