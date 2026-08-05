-- CreateEnum
CREATE TYPE "EmbeddingProvider" AS ENUM ('HASHING', 'VOYAGE');

-- AlterTable
ALTER TABLE "document_chunks" ADD COLUMN     "embedding_provider" "EmbeddingProvider" NOT NULL DEFAULT 'HASHING';
