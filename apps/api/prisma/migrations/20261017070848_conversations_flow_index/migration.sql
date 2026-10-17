-- CreateIndex
CREATE INDEX "conversations_flow_id_updated_at_id_idx" ON "conversations"("flow_id", "updated_at" DESC, "id");
