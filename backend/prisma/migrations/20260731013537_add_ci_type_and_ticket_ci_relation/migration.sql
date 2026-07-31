-- AlterTable
ALTER TABLE "configuration_items" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ci_types" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ci_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ci_types_name_key" ON "ci_types"("name");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_ci_id_fkey" FOREIGN KEY ("ci_id") REFERENCES "configuration_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuration_items" ADD CONSTRAINT "configuration_items_ci_type_id_fkey" FOREIGN KEY ("ci_type_id") REFERENCES "ci_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
