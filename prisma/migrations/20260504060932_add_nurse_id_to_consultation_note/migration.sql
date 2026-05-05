-- AlterTable
ALTER TABLE "ConsultationNote" ADD COLUMN     "nurse_id" TEXT;

-- CreateIndex
CREATE INDEX "ConsultationNote_nurse_id_idx" ON "ConsultationNote"("nurse_id");

-- AddForeignKey
ALTER TABLE "ConsultationNote" ADD CONSTRAINT "ConsultationNote_nurse_id_fkey" FOREIGN KEY ("nurse_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
