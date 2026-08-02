-- AlterTable
ALTER TABLE "configuration_items" ADD COLUMN     "license_id" TEXT;

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "purchased_at" TIMESTAMP(3),
    "reference_number" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "configuration_items_license_id_key" ON "configuration_items"("license_id");

-- AddForeignKey
ALTER TABLE "configuration_items" ADD CONSTRAINT "configuration_items_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
