-- Add composite indexes on ConsultationSession for history pagination
-- These improve cursor-based pagination ordered by createdAt for doctor and patient

CREATE INDEX IF NOT EXISTS "ConsultationSession_doctor_id_created_at_idx"
  ON "ConsultationSession" ("doctor_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "ConsultationSession_patient_id_created_at_idx"
  ON "ConsultationSession" ("patient_id", "created_at" DESC);
