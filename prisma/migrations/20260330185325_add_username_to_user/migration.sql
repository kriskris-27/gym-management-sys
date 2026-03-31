/*
  Warnings:

  - You are about to drop the column `email` on the `User` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[username]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "username" TEXT;

-- Update existing records to have usernames based on email
UPDATE "User" SET "username" = 'admin' WHERE "email" IS NOT NULL;

-- Make username required after updating existing records
ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;

-- Drop the email column
ALTER TABLE "User" DROP COLUMN "email";

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
