-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "NotificationLog"
ADD COLUMN "attemptNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
ADD COLUMN "errorCode" TEXT,
ADD COLUMN "errorMessage" TEXT,
ADD COLUMN "memberNameSnapshot" TEXT,
ADD COLUMN "meta" JSONB,
ADD COLUMN "providerMessageId" TEXT,
ADD COLUMN "recipientPhone" TEXT,
ADD COLUMN "runId" TEXT,
ADD COLUMN "templateKey" TEXT,
ADD COLUMN "status_new" "NotificationStatus";

-- Backfill status + required audit snapshots for existing rows
UPDATE "NotificationLog"
SET
  "status_new" = CASE LOWER(COALESCE("NotificationLog"."status", ''))
    WHEN 'sent' THEN 'SENT'::"NotificationStatus"
    WHEN 'failed' THEN 'FAILED'::"NotificationStatus"
    WHEN 'skipped' THEN 'SKIPPED'::"NotificationStatus"
    ELSE 'FAILED'::"NotificationStatus"
  END,
  "runId" = COALESCE("runId", CONCAT('legacy-', "NotificationLog"."id")),
  "recipientPhone" = COALESCE("recipientPhone", m."phone"),
  "memberNameSnapshot" = COALESCE("memberNameSnapshot", m."name"),
  "templateKey" = COALESCE("templateKey", "NotificationLog"."type"::text)
FROM "Member" m
WHERE "NotificationLog"."memberId" = m."id";

-- Ensure all rows are fully populated before constraints
UPDATE "NotificationLog"
SET
  "runId" = COALESCE("runId", CONCAT('legacy-', "id")),
  "recipientPhone" = COALESCE("recipientPhone", ''),
  "memberNameSnapshot" = COALESCE("memberNameSnapshot", 'Unknown Member'),
  "templateKey" = COALESCE("templateKey", "NotificationLog"."type"::text),
  "status_new" = COALESCE("status_new", 'FAILED'::"NotificationStatus");

-- Swap old status column to enum-backed status
ALTER TABLE "NotificationLog" DROP COLUMN "status";
ALTER TABLE "NotificationLog" RENAME COLUMN "status_new" TO "status";

-- Enforce not-null audit fields
ALTER TABLE "NotificationLog"
ALTER COLUMN "status" SET NOT NULL,
ALTER COLUMN "runId" SET NOT NULL,
ALTER COLUMN "recipientPhone" SET NOT NULL,
ALTER COLUMN "memberNameSnapshot" SET NOT NULL,
ALTER COLUMN "templateKey" SET NOT NULL;

-- CreateIndex
CREATE INDEX "NotificationLog_memberId_idx" ON "NotificationLog"("memberId");
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");
CREATE INDEX "NotificationLog_type_idx" ON "NotificationLog"("type");
CREATE INDEX "NotificationLog_runId_idx" ON "NotificationLog"("runId");
CREATE INDEX "NotificationLog_sentAt_idx" ON "NotificationLog"("sentAt");
CREATE INDEX "NotificationLog_type_status_sentAt_idx" ON "NotificationLog"("type", "status", "sentAt");
