-- CreateTable
CREATE TABLE "flows" (
    -- COLLATE "C": orden por código de carácter (Prisma no modela la colación; ver gotcha-prisma-no-modela-colacion).
    "id" TEXT COLLATE "C" NOT NULL,
    "name_json" TEXT NOT NULL,
    "draft" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "latest_version" INTEGER,
    "unpublished_changes" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_versions" (
    -- COLLATE "C": igual que flows.id para que la clave foránea compare igual.
    "flow_id" TEXT COLLATE "C" NOT NULL,
    "version" INTEGER NOT NULL,
    "name_json" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "flow_versions_pkey" PRIMARY KEY ("flow_id","version")
);

-- CreateIndex
CREATE INDEX "flows_updated_at_id_idx" ON "flows"("updated_at" DESC, "id");

-- AddForeignKey
ALTER TABLE "flow_versions" ADD CONSTRAINT "flow_versions_flow_id_fkey" FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
