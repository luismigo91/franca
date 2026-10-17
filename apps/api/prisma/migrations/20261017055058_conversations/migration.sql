-- CreateEnum
CREATE TYPE "conversation_status" AS ENUM ('waiting', 'ended', 'failed');

-- CreateEnum
CREATE TYPE "transcript_role" AS ENUM ('user', 'flow');

-- CreateTable
CREATE TABLE "contacts" (
    -- COLLATE "C": orden e igualdad byte a byte (ver gotcha-prisma-no-modela-colacion); igual en las dos puntas de cada clave foránea.
    "contact_id" TEXT COLLATE "C" NOT NULL,
    "epoch" UUID NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("contact_id")
);

-- CreateTable
CREATE TABLE "contact_values" (
    "contact_id" TEXT COLLATE "C" NOT NULL,
    -- COLLATE "C": el nombre de una variable puede ser `__proto__` o cualquier texto, y se compara byte a byte.
    "name" TEXT COLLATE "C" NOT NULL,
    "value_json" TEXT NOT NULL,

    CONSTRAINT "contact_values_pkey" PRIMARY KEY ("contact_id","name")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    -- COLLATE "C": igual que flows.id. Sin clave foránea hacia flows/flow_versions (design D2).
    "flow_id" TEXT COLLATE "C" NOT NULL,
    "version" INTEGER NOT NULL,
    "contact_id" TEXT COLLATE "C",
    "status" "conversation_status" NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" TEXT,
    "pending_input_json" TEXT,
    "outcome" TEXT,
    "error_code" TEXT,
    "error_node_id" TEXT,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "cost_limit_reached" BOOLEAN NOT NULL,
    "transcript_length" INTEGER NOT NULL,
    "claim_token" UUID,
    "claimed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_entries" (
    "conversation_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "role" "transcript_role" NOT NULL,
    "payload" TEXT NOT NULL,

    CONSTRAINT "conversation_entries_pkey" PRIMARY KEY ("conversation_id","seq")
);

-- CreateIndex
CREATE INDEX "conversations_updated_at_id_idx" ON "conversations"("updated_at" DESC, "id");

-- CreateIndex
CREATE INDEX "conversations_contact_id_idx" ON "conversations"("contact_id");

-- AddForeignKey
ALTER TABLE "contact_values" ADD CONSTRAINT "contact_values_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("contact_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("contact_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_entries" ADD CONSTRAINT "conversation_entries_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
