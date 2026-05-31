-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Admin Management Features
-- Tambah kolom baru ke DoctorProfile, NurseProfile, PatientProfile
-- + tabel AuditLog baru di setiap tenant schema
-- Jalankan di Neon / pgAdmin untuk SETIAP tenant schema yang ada
-- Ganti {SCHEMA} dengan nama schema: tenant_demo_app, tenant_dharmanugraha, dll
-- ═══════════════════════════════════════════════════════════════════════════════

-- Jalankan untuk setiap schema yang ada (ganti nama schema)
DO $$
DECLARE
  schemas TEXT[] := ARRAY['tenant_demo_app']; -- tambah schema lain kalau ada
  s TEXT;
BEGIN
  FOREACH s IN ARRAY schemas LOOP

    -- DoctorProfile: tambah kolom baru
    EXECUTE format('ALTER TABLE %I."DoctorProfile" ADD COLUMN IF NOT EXISTS "specialization" TEXT', s);
    EXECUTE format('ALTER TABLE %I."DoctorProfile" ADD COLUMN IF NOT EXISTS "poli" TEXT', s);
    EXECUTE format('ALTER TABLE %I."DoctorProfile" ADD COLUMN IF NOT EXISTS "serviceCapability" TEXT', s);
    EXECUTE format('ALTER TABLE %I."DoctorProfile" ADD COLUMN IF NOT EXISTS "bio" TEXT', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "DoctorProfile_poli_idx" ON %I."DoctorProfile"("poli")', s);

    -- NurseProfile: tambah kolom baru
    EXECUTE format('ALTER TABLE %I."NurseProfile" ADD COLUMN IF NOT EXISTS "poli" TEXT', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "NurseProfile_poli_idx" ON %I."NurseProfile"("poli")', s);

    -- PatientProfile: tambah kolom baru + ubah bornDate jadi nullable
    EXECUTE format('ALTER TABLE %I."PatientProfile" ALTER COLUMN "bornDate" DROP NOT NULL', s);
    EXECUTE format('ALTER TABLE %I."PatientProfile" ADD COLUMN IF NOT EXISTS "gender" TEXT', s);
    EXECUTE format('ALTER TABLE %I."PatientProfile" ADD COLUMN IF NOT EXISTS "mrn" TEXT', s);
    EXECUTE format('ALTER TABLE %I."PatientProfile" ADD COLUMN IF NOT EXISTS "address" TEXT', s);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS "PatientProfile_mrn_tenantId_key" ON %I."PatientProfile"("mrn","tenantId")', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "PatientProfile_mrn_idx" ON %I."PatientProfile"("mrn")', s);

    -- AuditLog: tabel baru
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I."AuditLog" (
      "id"          TEXT         PRIMARY KEY,
      "tenantId"    TEXT         NOT NULL,
      "actorId"     TEXT,
      "actorName"   TEXT,
      "actorRole"   TEXT,
      "action"      TEXT         NOT NULL,
      "targetType"  TEXT,
      "targetId"    TEXT,
      "metadata"    JSONB,
      "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    )', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "AL_tenantId_idx" ON %I."AuditLog"("tenantId")', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "AL_tenantId_created_idx" ON %I."AuditLog"("tenantId","created_at" DESC)', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "AL_actorId_idx" ON %I."AuditLog"("actorId")', s);
    EXECUTE format('CREATE INDEX IF NOT EXISTS "AL_action_idx" ON %I."AuditLog"("action")', s);

    RAISE NOTICE 'Schema % migrated OK', s;
  END LOOP;
END $$;
