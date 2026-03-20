-- DropIndex
DROP INDEX "Attendance_memberId_date_key";

-- CreateIndex
CREATE INDEX "Attendance_memberId_date_idx" ON "Attendance"("memberId", "date");
