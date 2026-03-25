-- CreateEnum
CREATE TYPE "AutoCloseReason" AS ENUM ('MAX_DURATION', 'PREVIOUS_DAY');

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "autoCloseReason" "AutoCloseReason";

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE INDEX "Attendance_checkedInAt_idx" ON "Attendance"("checkedInAt");

-- CreateIndex
CREATE INDEX "Attendance_checkedOutAt_idx" ON "Attendance"("checkedOutAt");

-- CreateIndex
CREATE INDEX "Attendance_autoClosed_idx" ON "Attendance"("autoClosed");
