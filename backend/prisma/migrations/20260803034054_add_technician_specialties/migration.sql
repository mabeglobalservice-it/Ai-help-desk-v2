-- CreateTable
CREATE TABLE "technician_specialties" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "technician_specialties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "technician_specialties_user_id_category_id_key" ON "technician_specialties"("user_id", "category_id");

-- AddForeignKey
ALTER TABLE "technician_specialties" ADD CONSTRAINT "technician_specialties_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_specialties" ADD CONSTRAINT "technician_specialties_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "ticket_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
