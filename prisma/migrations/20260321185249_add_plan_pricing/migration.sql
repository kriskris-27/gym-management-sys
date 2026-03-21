-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "customPrice" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PlanPricing" (
    "id" TEXT NOT NULL,
    "membershipType" "MembershipType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanPricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanPricing_membershipType_key" ON "PlanPricing"("membershipType");
