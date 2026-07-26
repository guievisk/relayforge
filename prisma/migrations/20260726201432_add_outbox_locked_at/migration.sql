-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "outbox_events_lockedAt_idx" ON "outbox_events"("lockedAt");
