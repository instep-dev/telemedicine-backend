-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'NURSE';

-- AlterTable
ALTER TABLE "ConsultationSession" ADD COLUMN     "nurse_id" TEXT,
ADD COLUMN     "nurse_identity" TEXT,
ADD COLUMN     "nurse_joined_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PendingRegistration" ADD COLUMN     "nurseId" TEXT;

-- CreateTable
CREATE TABLE "NurseProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT,
    "nurseId" TEXT NOT NULL,
    "profilePicture" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NurseProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NurseIdWhitelist" (
    "id" TEXT NOT NULL,
    "nurseId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NurseIdWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NurseProfile_userId_key" ON "NurseProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NurseProfile_email_key" ON "NurseProfile"("email");

-- CreateIndex
CREATE UNIQUE INDEX "NurseProfile_phone_key" ON "NurseProfile"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "NurseProfile_nurseId_key" ON "NurseProfile"("nurseId");

-- CreateIndex
CREATE INDEX "NurseProfile_nurseId_idx" ON "NurseProfile"("nurseId");

-- CreateIndex
CREATE UNIQUE INDEX "NurseIdWhitelist_nurseId_key" ON "NurseIdWhitelist"("nurseId");

-- CreateIndex
CREATE INDEX "ConsultationSession_nurse_id_idx" ON "ConsultationSession"("nurse_id");

-- CreateIndex
CREATE INDEX "ConsultationSession_nurse_id_scheduled_start_time_idx" ON "ConsultationSession"("nurse_id", "scheduled_start_time");

-- AddForeignKey
ALTER TABLE "NurseProfile" ADD CONSTRAINT "NurseProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationSession" ADD CONSTRAINT "ConsultationSession_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
