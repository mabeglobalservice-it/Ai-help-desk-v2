-- CreateTable
CREATE TABLE "search_logs" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "result_count" INTEGER NOT NULL,
    "low_confidence" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_log_results" (
    "id" TEXT NOT NULL,
    "search_log_id" TEXT NOT NULL,
    "origin_id" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "rank" DOUBLE PRECISION NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "search_log_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "search_logs_created_at_idx" ON "search_logs"("created_at");

-- CreateIndex
CREATE INDEX "search_log_results_origin_id_idx" ON "search_log_results"("origin_id");

-- AddForeignKey
ALTER TABLE "search_logs" ADD CONSTRAINT "search_logs_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_log_results" ADD CONSTRAINT "search_log_results_search_log_id_fkey" FOREIGN KEY ("search_log_id") REFERENCES "search_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
