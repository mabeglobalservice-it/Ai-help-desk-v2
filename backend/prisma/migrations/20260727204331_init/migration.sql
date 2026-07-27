-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'TECHNICIAN', 'SUPERVISOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED');

-- CreateEnum
CREATE TYPE "Criticality" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CiStatus" AS ENUM ('ACTIVE', 'IN_REPAIR', 'RETIRED');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('DEPENDS_ON', 'HOSTS', 'CONNECTS_TO', 'RUNS_ON');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AI_AGENT', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "entra_id" TEXT,
    "department_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "technician_id" TEXT,
    "category_id" TEXT NOT NULL,
    "priority_id" TEXT NOT NULL,
    "ci_id" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'NEW',
    "sla_due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_status_history" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuration_items" (
    "id" TEXT NOT NULL,
    "ci_type_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inventory_number" TEXT NOT NULL,
    "serial_number" TEXT,
    "criticality" "Criticality" NOT NULL DEFAULT 'MEDIUM',
    "status" "CiStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "configuration_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ci_relationships" (
    "id" TEXT NOT NULL,
    "parent_ci_id" TEXT NOT NULL,
    "child_ci_id" TEXT NOT NULL,
    "relationship_type" "RelationshipType" NOT NULL,

    CONSTRAINT "ci_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_type" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "ip_address" TEXT,
    "before_state" JSONB,
    "after_state" JSONB,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_entra_id_key" ON "users"("entra_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_reference_key" ON "tickets"("reference");

-- CreateIndex
CREATE INDEX "tickets_status_priority_id_technician_id_category_id_idx" ON "tickets"("status", "priority_id", "technician_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "configuration_items_inventory_number_key" ON "configuration_items"("inventory_number");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_target_type_target_id_created_at_idx" ON "audit_logs"("actor_id", "target_type", "target_id", "created_at");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_technician_id_fkey" FOREIGN KEY ("technician_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_status_history" ADD CONSTRAINT "ticket_status_history_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ci_relationships" ADD CONSTRAINT "ci_relationships_parent_ci_id_fkey" FOREIGN KEY ("parent_ci_id") REFERENCES "configuration_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ci_relationships" ADD CONSTRAINT "ci_relationships_child_ci_id_fkey" FOREIGN KEY ("child_ci_id") REFERENCES "configuration_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
