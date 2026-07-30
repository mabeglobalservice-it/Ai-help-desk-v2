-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "rated_at" TIMESTAMP(3),
ADD COLUMN     "rating" INTEGER,
ADD COLUMN     "rating_comment" TEXT;
