-- ═══════════════════════════════════════════════════════════════════════════════
-- MULTI-TENANT FRESH START SCRIPT
-- Paste ke pgAdmin Query Tool → F5
-- Drop semua lalu rebuild dari 0. Tidak perlu jalankan apapun sebelumnya.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1: DROP EVERYTHING
-- ─────────────────────────────────────────────────────────────────────────────

DROP SCHEMA IF EXISTS tenant_dharmanugraha CASCADE;
DROP SCHEMA IF EXISTS tenant_darramedika   CASCADE;
DROP SCHEMA IF EXISTS tenant_counseling    CASCADE;
DROP SCHEMA IF EXISTS tenant_demo_app      CASCADE;

DROP TABLE IF EXISTS public."ConsultationSessionAudit" CASCADE;
DROP TABLE IF EXISTS public."ConsultationNote"         CASCADE;
DROP TABLE IF EXISTS public."ConsultationSession"      CASCADE;
DROP TABLE IF EXISTS public."AuthAuditLog"             CASCADE;
DROP TABLE IF EXISTS public."PendingPasswordReset"     CASCADE;
DROP TABLE IF EXISTS public."PendingEmailChange"       CASCADE;
DROP TABLE IF EXISTS public."RefreshToken"             CASCADE;
DROP TABLE IF EXISTS public."OAuthAccount"             CASCADE;
DROP TABLE IF EXISTS public."NurseProfile"             CASCADE;
DROP TABLE IF EXISTS public."PatientProfile"           CASCADE;
DROP TABLE IF EXISTS public."AdminProfile"             CASCADE;
DROP TABLE IF EXISTS public."DoctorProfile"            CASCADE;
DROP TABLE IF EXISTS public."User"                     CASCADE;
DROP TABLE IF EXISTS public."LicenseWhitelist"         CASCADE;
DROP TABLE IF EXISTS public."AdminIdWhitelist"         CASCADE;
DROP TABLE IF EXISTS public."NurseIdWhitelist"         CASCADE;
DROP TABLE IF EXISTS public."MrnWhitelist"             CASCADE;
DROP TABLE IF EXISTS public."StaffProfile"             CASCADE;
DROP TABLE IF EXISTS public."StaffIdWhitelist"         CASCADE;
DROP TABLE IF EXISTS public."OAuthState"               CASCADE;
DROP TABLE IF EXISTS public."OAuthPending"             CASCADE;
DROP TABLE IF EXISTS public."PendingRegistration"      CASCADE;
DROP TABLE IF EXISTS public.tenant_registry            CASCADE;

DROP TYPE IF EXISTS public."UserRole"         CASCADE;
DROP TYPE IF EXISTS public."OAuthProvider"    CASCADE;
DROP TYPE IF EXISTS public."SessionType"      CASCADE;
DROP TYPE IF EXISTS public."ConsultationMode" CASCADE;
DROP TYPE IF EXISTS public."SessionStatus"    CASCADE;
DROP TYPE IF EXISTS public."AuthAction"       CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 2: ENUMS (public schema only)
-- Enum di setiap tenant schema dibuat di masing-masing Phase 4 block,
-- setelah CREATE SCHEMA, sehingga land di schema yang benar.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public."UserRole"         AS ENUM ('DOCTOR', 'ADMIN', 'PATIENT', 'NURSE');
CREATE TYPE public."OAuthProvider"    AS ENUM ('GOOGLE', 'MICROSOFT');
CREATE TYPE public."SessionType"      AS ENUM ('SCHEDULED', 'INSTANT');
CREATE TYPE public."ConsultationMode" AS ENUM ('VIDEO', 'VOICE');
CREATE TYPE public."SessionStatus"    AS ENUM ('CREATED', 'IN_CALL', 'COMPLETED', 'FAILED');
CREATE TYPE public."AuthAction"       AS ENUM ('REGISTER', 'LOGIN', 'LOGOUT', 'REFRESH', 'TOKEN_REVOKE');

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 3: PUBLIC SCHEMA TABLES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.tenant_registry (
  id            TEXT         PRIMARY KEY,
  slug          VARCHAR(100) NOT NULL UNIQUE,
  name          VARCHAR(255) NOT NULL,
  schema_name   VARCHAR(100) NOT NULL UNIQUE,
  status        VARCHAR(50)  NOT NULL DEFAULT 'active',
  admin_email   VARCHAR(255),
  contact_phone VARCHAR(20),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX tenant_registry_slug_idx   ON public.tenant_registry (slug);
CREATE INDEX tenant_registry_status_idx ON public.tenant_registry (status);

INSERT INTO public.tenant_registry (id, slug, name, schema_name) VALUES
  ('550e8400-e29b-41d4-a716-446655440000', 'dharmanugraha', 'RS Dharma Nugraha', 'tenant_dharmanugraha'),
  ('660f9511-f3ac-52e5-b827-557766551111', 'darramedika',   'RS Darra Medika',   'tenant_darramedika'),
  ('770a0622-04bd-63f6-c938-668877662222', 'counseling',    'Counseling Center', 'tenant_counseling'),
  ('880b1733-15ce-74a7-da49-779988773333', 'demo-app',      'Demo App',          'tenant_demo_app');

CREATE TABLE public."OAuthState" (
  "id"          TEXT          PRIMARY KEY,
  "tenantSlug"  TEXT          NOT NULL,
  "provider"    public."OAuthProvider" NOT NULL,
  "role"        public."UserRole"      NOT NULL,
  "redirectUrl" TEXT,
  "expiresAt"   TIMESTAMP(3)  NOT NULL,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OAuthState_tenantSlug_idx" ON public."OAuthState"("tenantSlug");
CREATE INDEX "OAuthState_expiresAt_idx"  ON public."OAuthState"("expiresAt");

CREATE TABLE public."OAuthPending" (
  "id"             TEXT          PRIMARY KEY,
  "tenantSlug"     TEXT          NOT NULL,
  "provider"       public."OAuthProvider" NOT NULL,
  "role"           public."UserRole"      NOT NULL,
  "providerUserId" TEXT          NOT NULL,
  "email"          TEXT          NOT NULL,
  "name"           TEXT,
  "expiresAt"      TIMESTAMP(3)  NOT NULL,
  "createdAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "OAuthPending_provider_providerUserId_tenantSlug_key"
  ON public."OAuthPending"("provider","providerUserId","tenantSlug");
CREATE INDEX "OAuthPending_email_idx"     ON public."OAuthPending"("email");
CREATE INDEX "OAuthPending_expiresAt_idx" ON public."OAuthPending"("expiresAt");

CREATE TABLE public."PendingRegistration" (
  "id"           TEXT         PRIMARY KEY,
  "tenantSlug"   TEXT         NOT NULL,
  "role"         public."UserRole" NOT NULL,
  "email"        TEXT         NOT NULL,
  "phone"        TEXT         NOT NULL,
  "name"         TEXT         NOT NULL,
  "passwordHash" TEXT         NOT NULL,
  "license"      TEXT,
  "adminId"      TEXT,
  "nurseId"      TEXT,
  "bornDate"     TIMESTAMP(3),
  "tokenHash"    TEXT         NOT NULL UNIQUE,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PendingRegistration_tenantSlug_idx" ON public."PendingRegistration"("tenantSlug");
CREATE INDEX "PendingRegistration_email_idx"      ON public."PendingRegistration"("email");
CREATE INDEX "PendingRegistration_phone_idx"      ON public."PendingRegistration"("phone");
CREATE INDEX "PendingRegistration_expiresAt_idx"  ON public."PendingRegistration"("expiresAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4A: tenant_dharmanugraha
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA tenant_dharmanugraha;
SET search_path TO tenant_dharmanugraha, public;

-- Enums dibuat unqualified → land di tenant_dharmanugraha
CREATE TYPE "UserRole"         AS ENUM ('DOCTOR', 'ADMIN', 'PATIENT', 'NURSE');
CREATE TYPE "OAuthProvider"    AS ENUM ('GOOGLE', 'MICROSOFT');
CREATE TYPE "SessionType"      AS ENUM ('SCHEDULED', 'INSTANT');
CREATE TYPE "ConsultationMode" AS ENUM ('VIDEO', 'VOICE');
CREATE TYPE "SessionStatus"    AS ENUM ('CREATED', 'IN_CALL', 'COMPLETED', 'FAILED');
CREATE TYPE "AuthAction"       AS ENUM ('REGISTER', 'LOGIN', 'LOGOUT', 'REFRESH', 'TOKEN_REVOKE');

CREATE TABLE "User" (
  "id"              TEXT PRIMARY KEY,
  "tenantId"        TEXT NOT NULL,
  "role"            "UserRole" NOT NULL,
  "name"            TEXT NOT NULL,
  "twilioIdentity"  TEXT,
  "isActive"        BOOLEAN      NOT NULL DEFAULT true,
  "emailVerifiedAt" TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "User_twilioIdentity_tenantId_key" ON "User"("twilioIdentity","tenantId");
CREATE INDEX "User_tenantId_idx"      ON "User"("tenantId");
CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId","role");
CREATE INDEX "User_role_idx"          ON "User"("role");
CREATE INDEX "User_isActive_idx"      ON "User"("isActive");

CREATE TABLE "DoctorProfile" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL UNIQUE,
  "fullName" TEXT NOT NULL, "email" TEXT NOT NULL, "phone" TEXT NOT NULL,
  "passwordHash" TEXT, "license" TEXT NOT NULL, "profilePicture" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "DoctorProfile_email_tenantId_key"   ON "DoctorProfile"("email","tenantId");
CREATE UNIQUE INDEX "DoctorProfile_phone_tenantId_key"   ON "DoctorProfile"("phone","tenantId");
CREATE UNIQUE INDEX "DoctorProfile_license_tenantId_key" ON "DoctorProfile"("license","tenantId");
CREATE INDEX "DoctorProfile_tenantId_idx" ON "DoctorProfile"("tenantId");
CREATE INDEX "DoctorProfile_license_idx"  ON "DoctorProfile"("license");

CREATE TABLE "AdminProfile" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL UNIQUE,
  "fullName" TEXT NOT NULL, "email" TEXT NOT NULL, "phone" TEXT NOT NULL,
  "passwordHash" TEXT, "adminId" TEXT NOT NULL, "profilePicture" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "AdminProfile_email_tenantId_key"   ON "AdminProfile"("email","tenantId");
CREATE UNIQUE INDEX "AdminProfile_phone_tenantId_key"   ON "AdminProfile"("phone","tenantId");
CREATE UNIQUE INDEX "AdminProfile_adminId_tenantId_key" ON "AdminProfile"("adminId","tenantId");
CREATE INDEX "AdminProfile_tenantId_idx" ON "AdminProfile"("tenantId");
CREATE INDEX "AdminProfile_adminId_idx"  ON "AdminProfile"("adminId");

CREATE TABLE "PatientProfile" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL UNIQUE,
  "fullName" TEXT NOT NULL, "email" TEXT NOT NULL, "phone" TEXT NOT NULL,
  "passwordHash" TEXT, "bornDate" TIMESTAMP(3) NOT NULL, "profilePicture" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "PatientProfile_email_tenantId_key" ON "PatientProfile"("email","tenantId");
CREATE UNIQUE INDEX "PatientProfile_phone_tenantId_key" ON "PatientProfile"("phone","tenantId");
CREATE INDEX "PatientProfile_tenantId_idx" ON "PatientProfile"("tenantId");

CREATE TABLE "NurseProfile" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL UNIQUE,
  "fullName" TEXT NOT NULL, "email" TEXT NOT NULL, "phone" TEXT NOT NULL,
  "passwordHash" TEXT, "nurseId" TEXT NOT NULL, "profilePicture" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NurseProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "NurseProfile_email_tenantId_key"   ON "NurseProfile"("email","tenantId");
CREATE UNIQUE INDEX "NurseProfile_phone_tenantId_key"   ON "NurseProfile"("phone","tenantId");
CREATE UNIQUE INDEX "NurseProfile_nurseId_tenantId_key" ON "NurseProfile"("nurseId","tenantId");
CREATE INDEX "NurseProfile_tenantId_idx" ON "NurseProfile"("tenantId");
CREATE INDEX "NurseProfile_nurseId_idx"  ON "NurseProfile"("nurseId");

CREATE TABLE "OAuthAccount" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "provider" "OAuthProvider" NOT NULL, "providerUserId" TEXT NOT NULL, "email" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "OAuthAccount_provider_providerUserId_tenantId_key" ON "OAuthAccount"("provider","providerUserId","tenantId");
CREATE INDEX "OAuthAccount_tenantId_idx" ON "OAuthAccount"("tenantId");
CREATE INDEX "OAuthAccount_userId_idx"   ON "OAuthAccount"("userId");

CREATE TABLE "RefreshToken" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE, "userAgent" TEXT, "ip" TEXT, "revokedAt" TIMESTAMP(3),
  "replacedByTokenId" TEXT UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshToken_userId_fkey"             FOREIGN KEY ("userId")            REFERENCES "User"("id")         ON DELETE CASCADE,
  CONSTRAINT "RefreshToken_replacedByTokenId_fkey"  FOREIGN KEY ("replacedByTokenId") REFERENCES "RefreshToken"("id")
);
CREATE INDEX "RefreshToken_tenantId_idx"  ON "RefreshToken"("tenantId");
CREATE INDEX "RefreshToken_userId_idx"    ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");
CREATE INDEX "RefreshToken_revokedAt_idx" ON "RefreshToken"("revokedAt");

CREATE TABLE "PendingEmailChange" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "newEmail" TEXT NOT NULL, "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendingEmailChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "PendingEmailChange_tenantId_idx"  ON "PendingEmailChange"("tenantId");
CREATE INDEX "PendingEmailChange_userId_idx"    ON "PendingEmailChange"("userId");
CREATE INDEX "PendingEmailChange_expiresAt_idx" ON "PendingEmailChange"("expiresAt");
CREATE INDEX "PendingEmailChange_newEmail_idx"  ON "PendingEmailChange"("newEmail");

CREATE TABLE "PendingPasswordReset" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PendingPasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "PendingPasswordReset_tenantId_idx"  ON "PendingPasswordReset"("tenantId");
CREATE INDEX "PendingPasswordReset_userId_idx"    ON "PendingPasswordReset"("userId");
CREATE INDEX "PendingPasswordReset_expiresAt_idx" ON "PendingPasswordReset"("expiresAt");

CREATE TABLE "LicenseWhitelist" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "license" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "LicenseWhitelist_license_tenantId_key" ON "LicenseWhitelist"("license","tenantId");
CREATE INDEX "LicenseWhitelist_tenantId_idx" ON "LicenseWhitelist"("tenantId");

CREATE TABLE "AdminIdWhitelist" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "adminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AdminIdWhitelist_adminId_tenantId_key" ON "AdminIdWhitelist"("adminId","tenantId");
CREATE INDEX "AdminIdWhitelist_tenantId_idx" ON "AdminIdWhitelist"("tenantId");

CREATE TABLE "NurseIdWhitelist" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "nurseId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "NurseIdWhitelist_nurseId_tenantId_key" ON "NurseIdWhitelist"("nurseId","tenantId");
CREATE INDEX "NurseIdWhitelist_tenantId_idx" ON "NurseIdWhitelist"("tenantId");

CREATE TABLE "MrnWhitelist" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "mrn" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MrnWhitelist_mrn_tenantId_key" ON "MrnWhitelist"("mrn","tenantId");
CREATE INDEX "MrnWhitelist_tenantId_idx" ON "MrnWhitelist"("tenantId");

CREATE TABLE "AuthAuditLog" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "userId" TEXT, "email" TEXT,
  "action" "AuthAction" NOT NULL, "success" BOOLEAN NOT NULL DEFAULT false,
  "ip" TEXT, "userAgent" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "AuthAuditLog_tenantId_idx"           ON "AuthAuditLog"("tenantId");
CREATE INDEX "AuthAuditLog_tenantId_createdAt_idx" ON "AuthAuditLog"("tenantId","createdAt");
CREATE INDEX "AuthAuditLog_userId_idx"             ON "AuthAuditLog"("userId");
CREATE INDEX "AuthAuditLog_action_idx"             ON "AuthAuditLog"("action");
CREATE INDEX "AuthAuditLog_createdAt_idx"          ON "AuthAuditLog"("createdAt");

CREATE TABLE "ConsultationSession" (
  "session_id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "patient_id" TEXT NOT NULL, "doctor_id" TEXT NOT NULL,
  "session_type" "SessionType" NOT NULL, "consultation_mode" "ConsultationMode" NOT NULL,
  "scheduled_date" DATE NOT NULL, "scheduled_start_time" TIMESTAMP(3) NOT NULL,
  "duration_minutes" INTEGER, "scheduled_end_time" TIMESTAMP(3),
  "session_status" "SessionStatus" NOT NULL DEFAULT 'CREATED',
  "created_by" TEXT NOT NULL, "nurse_id" TEXT, "room_name" TEXT NOT NULL,
  "twilio_room_sid" TEXT, "doctor_identity" TEXT, "patient_identity" TEXT, "patient_name" TEXT,
  "patient_country_code" TEXT, "patient_country" TEXT, "patient_province" TEXT, "patient_city" TEXT,
  "patient_latitude" DOUBLE PRECISION, "patient_longitude" DOUBLE PRECISION,
  "nurse_joined_at" TIMESTAMP(3), "nurse_identity" TEXT,
  "doctor_joined_at" TIMESTAMP(3), "patient_joined_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3), "ended_at" TIMESTAMP(3),
  "recording_enabled" BOOLEAN NOT NULL DEFAULT false, "recording_status" TEXT,
  "recording_started_at" TIMESTAMP(3), "recording_completed_at" TIMESTAMP(3),
  "composition_sid" TEXT, "composition_status" TEXT,
  "composition_started_at" TIMESTAMP(3), "composition_ready_at" TIMESTAMP(3),
  "media_url" TEXT, "media_format" TEXT, "duration_sec" INTEGER, "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CS_patient_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "CS_doctor_fkey"  FOREIGN KEY ("doctor_id")  REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "CS_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "CS_nurse_fkey"   FOREIGN KEY ("nurse_id")   REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "CS_room_name_tenantId_key"      ON "ConsultationSession"("room_name","tenantId");
CREATE UNIQUE INDEX "CS_twilio_room_sid_tenantId_key" ON "ConsultationSession"("twilio_room_sid","tenantId");
CREATE UNIQUE INDEX "CS_composition_sid_tenantId_key" ON "ConsultationSession"("composition_sid","tenantId");
CREATE INDEX "CS_tenantId_idx"    ON "ConsultationSession"("tenantId");
CREATE INDEX "CS_tid_did_sst_idx" ON "ConsultationSession"("tenantId","doctor_id","scheduled_start_time");
CREATE INDEX "CS_tid_pid_sst_idx" ON "ConsultationSession"("tenantId","patient_id","scheduled_start_time");
CREATE INDEX "CS_doctor_id_idx"   ON "ConsultationSession"("doctor_id");
CREATE INDEX "CS_patient_id_idx"  ON "ConsultationSession"("patient_id");
CREATE INDEX "CS_nurse_id_idx"    ON "ConsultationSession"("nurse_id");
CREATE INDEX "CS_created_by_idx"  ON "ConsultationSession"("created_by");
CREATE INDEX "CS_status_idx"      ON "ConsultationSession"("session_status");
CREATE INDEX "CS_sst_idx"         ON "ConsultationSession"("scheduled_start_time");
CREATE INDEX "CS_set_idx"         ON "ConsultationSession"("scheduled_end_time");
CREATE INDEX "CS_did_sst_idx"     ON "ConsultationSession"("doctor_id","scheduled_start_time");
CREATE INDEX "CS_pid_sst_idx"     ON "ConsultationSession"("patient_id","scheduled_start_time");
CREATE INDEX "CS_nid_sst_idx"     ON "ConsultationSession"("nurse_id","scheduled_start_time");

CREATE TABLE "ConsultationNote" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "consultation_session_id" TEXT NOT NULL UNIQUE,
  "doctorId" TEXT NOT NULL, "patient_id" TEXT NOT NULL, "nurse_id" TEXT,
  "transcriptRaw" TEXT, "summary" TEXT, "subjective" TEXT, "objective" TEXT,
  "assessment" TEXT, "plan" TEXT, "aiStatus" TEXT, "aiError" TEXT,
  "is_finalized" BOOLEAN NOT NULL DEFAULT false, "finalized_at" TIMESTAMP(3),
  "transcribedAt" TIMESTAMP(3), "summarizedAt" TIMESTAMP(3), "aiModel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CN_session_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE,
  CONSTRAINT "CN_doctor_fkey"  FOREIGN KEY ("doctorId")   REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "CN_patient_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "CN_nurse_fkey"   FOREIGN KEY ("nurse_id")   REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "CN_tenantId_idx"   ON "ConsultationNote"("tenantId");
CREATE INDEX "CN_doctorId_idx"   ON "ConsultationNote"("doctorId");
CREATE INDEX "CN_patient_id_idx" ON "ConsultationNote"("patient_id");
CREATE INDEX "CN_nurse_id_idx"   ON "ConsultationNote"("nurse_id");
CREATE INDEX "CN_did_cat_idx"    ON "ConsultationNote"("doctorId","createdAt" DESC);
CREATE INDEX "CN_pid_cat_idx"    ON "ConsultationNote"("patient_id","createdAt" DESC);
CREATE INDEX "CN_session_idx"    ON "ConsultationNote"("consultation_session_id");

CREATE TABLE "ConsultationSessionAudit" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "consultation_session_id" TEXT NOT NULL,
  "actor_user_id" TEXT, "actor_role" "UserRole",
  "action" TEXT NOT NULL,
  "previous_status" "SessionStatus", "new_status" "SessionStatus",
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CSA_session_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE,
  CONSTRAINT "CSA_actor_fkey"   FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "CSA_tenantId_idx" ON "ConsultationSessionAudit"("tenantId");
CREATE INDEX "CSA_session_idx"  ON "ConsultationSessionAudit"("consultation_session_id");
CREATE INDEX "CSA_actor_idx"    ON "ConsultationSessionAudit"("actor_user_id");
CREATE INDEX "CSA_created_idx"  ON "ConsultationSessionAudit"("created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4B: tenant_darramedika (struktur sama)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA tenant_darramedika;
SET search_path TO tenant_darramedika, public;

-- Enums dibuat unqualified → land di tenant_darramedika
CREATE TYPE "UserRole"         AS ENUM ('DOCTOR', 'ADMIN', 'PATIENT', 'NURSE');
CREATE TYPE "OAuthProvider"    AS ENUM ('GOOGLE', 'MICROSOFT');
CREATE TYPE "SessionType"      AS ENUM ('SCHEDULED', 'INSTANT');
CREATE TYPE "ConsultationMode" AS ENUM ('VIDEO', 'VOICE');
CREATE TYPE "SessionStatus"    AS ENUM ('CREATED', 'IN_CALL', 'COMPLETED', 'FAILED');
CREATE TYPE "AuthAction"       AS ENUM ('REGISTER', 'LOGIN', 'LOGOUT', 'REFRESH', 'TOKEN_REVOKE');

CREATE TABLE "User" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"role" "UserRole" NOT NULL,"name" TEXT NOT NULL,"twilioIdentity" TEXT,"isActive" BOOLEAN NOT NULL DEFAULT true,"emailVerifiedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "User_twilioIdentity_tenantId_key" ON "User"("twilioIdentity","tenantId"); CREATE INDEX "User_tenantId_idx" ON "User"("tenantId"); CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId","role"); CREATE INDEX "User_role_idx" ON "User"("role"); CREATE INDEX "User_isActive_idx" ON "User"("isActive");
CREATE TABLE "DoctorProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"license" TEXT NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "DoctorProfile_email_tenantId_key" ON "DoctorProfile"("email","tenantId"); CREATE UNIQUE INDEX "DoctorProfile_phone_tenantId_key" ON "DoctorProfile"("phone","tenantId"); CREATE UNIQUE INDEX "DoctorProfile_license_tenantId_key" ON "DoctorProfile"("license","tenantId"); CREATE INDEX "DoctorProfile_tenantId_idx" ON "DoctorProfile"("tenantId"); CREATE INDEX "DoctorProfile_license_idx" ON "DoctorProfile"("license");
CREATE TABLE "AdminProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"adminId" TEXT NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "AdminProfile_email_tenantId_key" ON "AdminProfile"("email","tenantId"); CREATE UNIQUE INDEX "AdminProfile_phone_tenantId_key" ON "AdminProfile"("phone","tenantId"); CREATE UNIQUE INDEX "AdminProfile_adminId_tenantId_key" ON "AdminProfile"("adminId","tenantId"); CREATE INDEX "AdminProfile_tenantId_idx" ON "AdminProfile"("tenantId"); CREATE INDEX "AdminProfile_adminId_idx" ON "AdminProfile"("adminId");
CREATE TABLE "PatientProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"bornDate" TIMESTAMP(3) NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "PatientProfile_email_tenantId_key" ON "PatientProfile"("email","tenantId"); CREATE UNIQUE INDEX "PatientProfile_phone_tenantId_key" ON "PatientProfile"("phone","tenantId"); CREATE INDEX "PatientProfile_tenantId_idx" ON "PatientProfile"("tenantId");
CREATE TABLE "NurseProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"nurseId" TEXT NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "NurseProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "NurseProfile_email_tenantId_key" ON "NurseProfile"("email","tenantId"); CREATE UNIQUE INDEX "NurseProfile_phone_tenantId_key" ON "NurseProfile"("phone","tenantId"); CREATE UNIQUE INDEX "NurseProfile_nurseId_tenantId_key" ON "NurseProfile"("nurseId","tenantId"); CREATE INDEX "NurseProfile_tenantId_idx" ON "NurseProfile"("tenantId"); CREATE INDEX "NurseProfile_nurseId_idx" ON "NurseProfile"("nurseId");
CREATE TABLE "OAuthAccount" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"provider" "OAuthProvider" NOT NULL,"providerUserId" TEXT NOT NULL,"email" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "OAuthAccount_provider_providerUserId_tenantId_key" ON "OAuthAccount"("provider","providerUserId","tenantId"); CREATE INDEX "OAuthAccount_tenantId_idx" ON "OAuthAccount"("tenantId"); CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");
CREATE TABLE "RefreshToken" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"tokenHash" TEXT NOT NULL UNIQUE,"userAgent" TEXT,"ip" TEXT,"revokedAt" TIMESTAMP(3),"replacedByTokenId" TEXT UNIQUE,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,CONSTRAINT "RefreshToken_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "RefreshToken"("id"));
CREATE INDEX "RefreshToken_tenantId_idx" ON "RefreshToken"("tenantId"); CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId"); CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt"); CREATE INDEX "RefreshToken_revokedAt_idx" ON "RefreshToken"("revokedAt");
CREATE TABLE "PendingEmailChange" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"newEmail" TEXT NOT NULL,"tokenHash" TEXT NOT NULL UNIQUE,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "PendingEmailChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE INDEX "PendingEmailChange_tenantId_idx" ON "PendingEmailChange"("tenantId"); CREATE INDEX "PendingEmailChange_userId_idx" ON "PendingEmailChange"("userId"); CREATE INDEX "PendingEmailChange_expiresAt_idx" ON "PendingEmailChange"("expiresAt"); CREATE INDEX "PendingEmailChange_newEmail_idx" ON "PendingEmailChange"("newEmail");
CREATE TABLE "PendingPasswordReset" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"tokenHash" TEXT NOT NULL UNIQUE,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "PendingPasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE INDEX "PendingPasswordReset_tenantId_idx" ON "PendingPasswordReset"("tenantId"); CREATE INDEX "PendingPasswordReset_userId_idx" ON "PendingPasswordReset"("userId"); CREATE INDEX "PendingPasswordReset_expiresAt_idx" ON "PendingPasswordReset"("expiresAt");
CREATE TABLE "LicenseWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"license" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "LicenseWhitelist_license_tenantId_key" ON "LicenseWhitelist"("license","tenantId"); CREATE INDEX "LicenseWhitelist_tenantId_idx" ON "LicenseWhitelist"("tenantId");
CREATE TABLE "AdminIdWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"adminId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "AdminIdWhitelist_adminId_tenantId_key" ON "AdminIdWhitelist"("adminId","tenantId"); CREATE INDEX "AdminIdWhitelist_tenantId_idx" ON "AdminIdWhitelist"("tenantId");
CREATE TABLE "NurseIdWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"nurseId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "NurseIdWhitelist_nurseId_tenantId_key" ON "NurseIdWhitelist"("nurseId","tenantId"); CREATE INDEX "NurseIdWhitelist_tenantId_idx" ON "NurseIdWhitelist"("tenantId");
CREATE TABLE "MrnWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"mrn" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "MrnWhitelist_mrn_tenantId_key" ON "MrnWhitelist"("mrn","tenantId"); CREATE INDEX "MrnWhitelist_tenantId_idx" ON "MrnWhitelist"("tenantId");
CREATE TABLE "AuthAuditLog" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT,"email" TEXT,"action" "AuthAction" NOT NULL,"success" BOOLEAN NOT NULL DEFAULT false,"ip" TEXT,"userAgent" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AuthAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE INDEX "AuthAuditLog_tenantId_idx" ON "AuthAuditLog"("tenantId"); CREATE INDEX "AuthAuditLog_tenantId_createdAt_idx" ON "AuthAuditLog"("tenantId","createdAt"); CREATE INDEX "AuthAuditLog_userId_idx" ON "AuthAuditLog"("userId"); CREATE INDEX "AuthAuditLog_action_idx" ON "AuthAuditLog"("action"); CREATE INDEX "AuthAuditLog_createdAt_idx" ON "AuthAuditLog"("createdAt");
CREATE TABLE "ConsultationSession" ("session_id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"patient_id" TEXT NOT NULL,"doctor_id" TEXT NOT NULL,"session_type" "SessionType" NOT NULL,"consultation_mode" "ConsultationMode" NOT NULL,"scheduled_date" DATE NOT NULL,"scheduled_start_time" TIMESTAMP(3) NOT NULL,"duration_minutes" INTEGER,"scheduled_end_time" TIMESTAMP(3),"session_status" "SessionStatus" NOT NULL DEFAULT 'CREATED',"created_by" TEXT NOT NULL,"nurse_id" TEXT,"room_name" TEXT NOT NULL,"twilio_room_sid" TEXT,"doctor_identity" TEXT,"patient_identity" TEXT,"patient_name" TEXT,"patient_country_code" TEXT,"patient_country" TEXT,"patient_province" TEXT,"patient_city" TEXT,"patient_latitude" DOUBLE PRECISION,"patient_longitude" DOUBLE PRECISION,"nurse_joined_at" TIMESTAMP(3),"nurse_identity" TEXT,"doctor_joined_at" TIMESTAMP(3),"patient_joined_at" TIMESTAMP(3),"started_at" TIMESTAMP(3),"ended_at" TIMESTAMP(3),"recording_enabled" BOOLEAN NOT NULL DEFAULT false,"recording_status" TEXT,"recording_started_at" TIMESTAMP(3),"recording_completed_at" TIMESTAMP(3),"composition_sid" TEXT,"composition_status" TEXT,"composition_started_at" TIMESTAMP(3),"composition_ready_at" TIMESTAMP(3),"media_url" TEXT,"media_format" TEXT,"duration_sec" INTEGER,"error_message" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "CS_patient_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CS_doctor_fkey" FOREIGN KEY ("doctor_id") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CS_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CS_nurse_fkey" FOREIGN KEY ("nurse_id") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE UNIQUE INDEX "CS_room_name_tenantId_key" ON "ConsultationSession"("room_name","tenantId"); CREATE UNIQUE INDEX "CS_twilio_room_sid_tenantId_key" ON "ConsultationSession"("twilio_room_sid","tenantId"); CREATE UNIQUE INDEX "CS_composition_sid_tenantId_key" ON "ConsultationSession"("composition_sid","tenantId"); CREATE INDEX "CS_tenantId_idx" ON "ConsultationSession"("tenantId"); CREATE INDEX "CS_tid_did_sst_idx" ON "ConsultationSession"("tenantId","doctor_id","scheduled_start_time"); CREATE INDEX "CS_tid_pid_sst_idx" ON "ConsultationSession"("tenantId","patient_id","scheduled_start_time"); CREATE INDEX "CS_doctor_id_idx" ON "ConsultationSession"("doctor_id"); CREATE INDEX "CS_patient_id_idx" ON "ConsultationSession"("patient_id"); CREATE INDEX "CS_nurse_id_idx" ON "ConsultationSession"("nurse_id"); CREATE INDEX "CS_created_by_idx" ON "ConsultationSession"("created_by"); CREATE INDEX "CS_status_idx" ON "ConsultationSession"("session_status"); CREATE INDEX "CS_sst_idx" ON "ConsultationSession"("scheduled_start_time"); CREATE INDEX "CS_set_idx" ON "ConsultationSession"("scheduled_end_time"); CREATE INDEX "CS_did_sst_idx" ON "ConsultationSession"("doctor_id","scheduled_start_time"); CREATE INDEX "CS_pid_sst_idx" ON "ConsultationSession"("patient_id","scheduled_start_time"); CREATE INDEX "CS_nid_sst_idx" ON "ConsultationSession"("nurse_id","scheduled_start_time");
CREATE TABLE "ConsultationNote" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"consultation_session_id" TEXT NOT NULL UNIQUE,"doctorId" TEXT NOT NULL,"patient_id" TEXT NOT NULL,"nurse_id" TEXT,"transcriptRaw" TEXT,"summary" TEXT,"subjective" TEXT,"objective" TEXT,"assessment" TEXT,"plan" TEXT,"aiStatus" TEXT,"aiError" TEXT,"is_finalized" BOOLEAN NOT NULL DEFAULT false,"finalized_at" TIMESTAMP(3),"transcribedAt" TIMESTAMP(3),"summarizedAt" TIMESTAMP(3),"aiModel" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "CN_session_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE,CONSTRAINT "CN_doctor_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CN_patient_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CN_nurse_fkey" FOREIGN KEY ("nurse_id") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE INDEX "CN_tenantId_idx" ON "ConsultationNote"("tenantId"); CREATE INDEX "CN_doctorId_idx" ON "ConsultationNote"("doctorId"); CREATE INDEX "CN_patient_id_idx" ON "ConsultationNote"("patient_id"); CREATE INDEX "CN_nurse_id_idx" ON "ConsultationNote"("nurse_id"); CREATE INDEX "CN_did_cat_idx" ON "ConsultationNote"("doctorId","createdAt" DESC); CREATE INDEX "CN_pid_cat_idx" ON "ConsultationNote"("patient_id","createdAt" DESC); CREATE INDEX "CN_session_idx" ON "ConsultationNote"("consultation_session_id");
CREATE TABLE "ConsultationSessionAudit" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"consultation_session_id" TEXT NOT NULL,"actor_user_id" TEXT,"actor_role" "UserRole","action" TEXT NOT NULL,"previous_status" "SessionStatus","new_status" "SessionStatus","metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "CSA_session_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE,CONSTRAINT "CSA_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE INDEX "CSA_tenantId_idx" ON "ConsultationSessionAudit"("tenantId"); CREATE INDEX "CSA_session_idx" ON "ConsultationSessionAudit"("consultation_session_id"); CREATE INDEX "CSA_actor_idx" ON "ConsultationSessionAudit"("actor_user_id"); CREATE INDEX "CSA_created_idx" ON "ConsultationSessionAudit"("created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4C: tenant_counseling (struktur sama)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA tenant_counseling;
SET search_path TO tenant_counseling, public;

-- Enums dibuat unqualified → land di tenant_counseling
CREATE TYPE "UserRole"         AS ENUM ('DOCTOR', 'ADMIN', 'PATIENT', 'NURSE');
CREATE TYPE "OAuthProvider"    AS ENUM ('GOOGLE', 'MICROSOFT');
CREATE TYPE "SessionType"      AS ENUM ('SCHEDULED', 'INSTANT');
CREATE TYPE "ConsultationMode" AS ENUM ('VIDEO', 'VOICE');
CREATE TYPE "SessionStatus"    AS ENUM ('CREATED', 'IN_CALL', 'COMPLETED', 'FAILED');
CREATE TYPE "AuthAction"       AS ENUM ('REGISTER', 'LOGIN', 'LOGOUT', 'REFRESH', 'TOKEN_REVOKE');

CREATE TABLE "User" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"role" "UserRole" NOT NULL,"name" TEXT NOT NULL,"twilioIdentity" TEXT,"isActive" BOOLEAN NOT NULL DEFAULT true,"emailVerifiedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "User_twilioIdentity_tenantId_key" ON "User"("twilioIdentity","tenantId"); CREATE INDEX "User_tenantId_idx" ON "User"("tenantId"); CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId","role"); CREATE INDEX "User_role_idx" ON "User"("role"); CREATE INDEX "User_isActive_idx" ON "User"("isActive");
CREATE TABLE "DoctorProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"license" TEXT NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "DoctorProfile_email_tenantId_key" ON "DoctorProfile"("email","tenantId"); CREATE UNIQUE INDEX "DoctorProfile_phone_tenantId_key" ON "DoctorProfile"("phone","tenantId"); CREATE UNIQUE INDEX "DoctorProfile_license_tenantId_key" ON "DoctorProfile"("license","tenantId"); CREATE INDEX "DoctorProfile_tenantId_idx" ON "DoctorProfile"("tenantId"); CREATE INDEX "DoctorProfile_license_idx" ON "DoctorProfile"("license");
CREATE TABLE "AdminProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"adminId" TEXT NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "AdminProfile_email_tenantId_key" ON "AdminProfile"("email","tenantId"); CREATE UNIQUE INDEX "AdminProfile_phone_tenantId_key" ON "AdminProfile"("phone","tenantId"); CREATE UNIQUE INDEX "AdminProfile_adminId_tenantId_key" ON "AdminProfile"("adminId","tenantId"); CREATE INDEX "AdminProfile_tenantId_idx" ON "AdminProfile"("tenantId"); CREATE INDEX "AdminProfile_adminId_idx" ON "AdminProfile"("adminId");
CREATE TABLE "PatientProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"bornDate" TIMESTAMP(3) NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "PatientProfile_email_tenantId_key" ON "PatientProfile"("email","tenantId"); CREATE UNIQUE INDEX "PatientProfile_phone_tenantId_key" ON "PatientProfile"("phone","tenantId"); CREATE INDEX "PatientProfile_tenantId_idx" ON "PatientProfile"("tenantId");
CREATE TABLE "NurseProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"nurseId" TEXT NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "NurseProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "NurseProfile_email_tenantId_key" ON "NurseProfile"("email","tenantId"); CREATE UNIQUE INDEX "NurseProfile_phone_tenantId_key" ON "NurseProfile"("phone","tenantId"); CREATE UNIQUE INDEX "NurseProfile_nurseId_tenantId_key" ON "NurseProfile"("nurseId","tenantId"); CREATE INDEX "NurseProfile_tenantId_idx" ON "NurseProfile"("tenantId"); CREATE INDEX "NurseProfile_nurseId_idx" ON "NurseProfile"("nurseId");
CREATE TABLE "OAuthAccount" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"provider" "OAuthProvider" NOT NULL,"providerUserId" TEXT NOT NULL,"email" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "OAuthAccount_provider_providerUserId_tenantId_key" ON "OAuthAccount"("provider","providerUserId","tenantId"); CREATE INDEX "OAuthAccount_tenantId_idx" ON "OAuthAccount"("tenantId"); CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");
CREATE TABLE "RefreshToken" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"tokenHash" TEXT NOT NULL UNIQUE,"userAgent" TEXT,"ip" TEXT,"revokedAt" TIMESTAMP(3),"replacedByTokenId" TEXT UNIQUE,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,CONSTRAINT "RefreshToken_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "RefreshToken"("id"));
CREATE INDEX "RefreshToken_tenantId_idx" ON "RefreshToken"("tenantId"); CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId"); CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt"); CREATE INDEX "RefreshToken_revokedAt_idx" ON "RefreshToken"("revokedAt");
CREATE TABLE "PendingEmailChange" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"newEmail" TEXT NOT NULL,"tokenHash" TEXT NOT NULL UNIQUE,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "PendingEmailChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE INDEX "PendingEmailChange_tenantId_idx" ON "PendingEmailChange"("tenantId"); CREATE INDEX "PendingEmailChange_userId_idx" ON "PendingEmailChange"("userId"); CREATE INDEX "PendingEmailChange_expiresAt_idx" ON "PendingEmailChange"("expiresAt"); CREATE INDEX "PendingEmailChange_newEmail_idx" ON "PendingEmailChange"("newEmail");
CREATE TABLE "PendingPasswordReset" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"tokenHash" TEXT NOT NULL UNIQUE,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "PendingPasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE INDEX "PendingPasswordReset_tenantId_idx" ON "PendingPasswordReset"("tenantId"); CREATE INDEX "PendingPasswordReset_userId_idx" ON "PendingPasswordReset"("userId"); CREATE INDEX "PendingPasswordReset_expiresAt_idx" ON "PendingPasswordReset"("expiresAt");
CREATE TABLE "LicenseWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"license" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "LicenseWhitelist_license_tenantId_key" ON "LicenseWhitelist"("license","tenantId"); CREATE INDEX "LicenseWhitelist_tenantId_idx" ON "LicenseWhitelist"("tenantId");
CREATE TABLE "AdminIdWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"adminId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "AdminIdWhitelist_adminId_tenantId_key" ON "AdminIdWhitelist"("adminId","tenantId"); CREATE INDEX "AdminIdWhitelist_tenantId_idx" ON "AdminIdWhitelist"("tenantId");
CREATE TABLE "NurseIdWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"nurseId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "NurseIdWhitelist_nurseId_tenantId_key" ON "NurseIdWhitelist"("nurseId","tenantId"); CREATE INDEX "NurseIdWhitelist_tenantId_idx" ON "NurseIdWhitelist"("tenantId");
CREATE TABLE "MrnWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"mrn" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "MrnWhitelist_mrn_tenantId_key" ON "MrnWhitelist"("mrn","tenantId"); CREATE INDEX "MrnWhitelist_tenantId_idx" ON "MrnWhitelist"("tenantId");
CREATE TABLE "AuthAuditLog" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT,"email" TEXT,"action" "AuthAction" NOT NULL,"success" BOOLEAN NOT NULL DEFAULT false,"ip" TEXT,"userAgent" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AuthAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE INDEX "AuthAuditLog_tenantId_idx" ON "AuthAuditLog"("tenantId"); CREATE INDEX "AuthAuditLog_tenantId_createdAt_idx" ON "AuthAuditLog"("tenantId","createdAt"); CREATE INDEX "AuthAuditLog_userId_idx" ON "AuthAuditLog"("userId"); CREATE INDEX "AuthAuditLog_action_idx" ON "AuthAuditLog"("action"); CREATE INDEX "AuthAuditLog_createdAt_idx" ON "AuthAuditLog"("createdAt");
CREATE TABLE "ConsultationSession" ("session_id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"patient_id" TEXT NOT NULL,"doctor_id" TEXT NOT NULL,"session_type" "SessionType" NOT NULL,"consultation_mode" "ConsultationMode" NOT NULL,"scheduled_date" DATE NOT NULL,"scheduled_start_time" TIMESTAMP(3) NOT NULL,"duration_minutes" INTEGER,"scheduled_end_time" TIMESTAMP(3),"session_status" "SessionStatus" NOT NULL DEFAULT 'CREATED',"created_by" TEXT NOT NULL,"nurse_id" TEXT,"room_name" TEXT NOT NULL,"twilio_room_sid" TEXT,"doctor_identity" TEXT,"patient_identity" TEXT,"patient_name" TEXT,"patient_country_code" TEXT,"patient_country" TEXT,"patient_province" TEXT,"patient_city" TEXT,"patient_latitude" DOUBLE PRECISION,"patient_longitude" DOUBLE PRECISION,"nurse_joined_at" TIMESTAMP(3),"nurse_identity" TEXT,"doctor_joined_at" TIMESTAMP(3),"patient_joined_at" TIMESTAMP(3),"started_at" TIMESTAMP(3),"ended_at" TIMESTAMP(3),"recording_enabled" BOOLEAN NOT NULL DEFAULT false,"recording_status" TEXT,"recording_started_at" TIMESTAMP(3),"recording_completed_at" TIMESTAMP(3),"composition_sid" TEXT,"composition_status" TEXT,"composition_started_at" TIMESTAMP(3),"composition_ready_at" TIMESTAMP(3),"media_url" TEXT,"media_format" TEXT,"duration_sec" INTEGER,"error_message" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "CS_patient_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CS_doctor_fkey" FOREIGN KEY ("doctor_id") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CS_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CS_nurse_fkey" FOREIGN KEY ("nurse_id") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE UNIQUE INDEX "CS_room_name_tenantId_key" ON "ConsultationSession"("room_name","tenantId"); CREATE UNIQUE INDEX "CS_twilio_room_sid_tenantId_key" ON "ConsultationSession"("twilio_room_sid","tenantId"); CREATE UNIQUE INDEX "CS_composition_sid_tenantId_key" ON "ConsultationSession"("composition_sid","tenantId"); CREATE INDEX "CS_tenantId_idx" ON "ConsultationSession"("tenantId"); CREATE INDEX "CS_tid_did_sst_idx" ON "ConsultationSession"("tenantId","doctor_id","scheduled_start_time"); CREATE INDEX "CS_tid_pid_sst_idx" ON "ConsultationSession"("tenantId","patient_id","scheduled_start_time"); CREATE INDEX "CS_doctor_id_idx" ON "ConsultationSession"("doctor_id"); CREATE INDEX "CS_patient_id_idx" ON "ConsultationSession"("patient_id"); CREATE INDEX "CS_nurse_id_idx" ON "ConsultationSession"("nurse_id"); CREATE INDEX "CS_created_by_idx" ON "ConsultationSession"("created_by"); CREATE INDEX "CS_status_idx" ON "ConsultationSession"("session_status"); CREATE INDEX "CS_sst_idx" ON "ConsultationSession"("scheduled_start_time"); CREATE INDEX "CS_set_idx" ON "ConsultationSession"("scheduled_end_time"); CREATE INDEX "CS_did_sst_idx" ON "ConsultationSession"("doctor_id","scheduled_start_time"); CREATE INDEX "CS_pid_sst_idx" ON "ConsultationSession"("patient_id","scheduled_start_time"); CREATE INDEX "CS_nid_sst_idx" ON "ConsultationSession"("nurse_id","scheduled_start_time");
CREATE TABLE "ConsultationNote" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"consultation_session_id" TEXT NOT NULL UNIQUE,"doctorId" TEXT NOT NULL,"patient_id" TEXT NOT NULL,"nurse_id" TEXT,"transcriptRaw" TEXT,"summary" TEXT,"subjective" TEXT,"objective" TEXT,"assessment" TEXT,"plan" TEXT,"aiStatus" TEXT,"aiError" TEXT,"is_finalized" BOOLEAN NOT NULL DEFAULT false,"finalized_at" TIMESTAMP(3),"transcribedAt" TIMESTAMP(3),"summarizedAt" TIMESTAMP(3),"aiModel" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "CN_session_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE,CONSTRAINT "CN_doctor_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CN_patient_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CN_nurse_fkey" FOREIGN KEY ("nurse_id") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE INDEX "CN_tenantId_idx" ON "ConsultationNote"("tenantId"); CREATE INDEX "CN_doctorId_idx" ON "ConsultationNote"("doctorId"); CREATE INDEX "CN_patient_id_idx" ON "ConsultationNote"("patient_id"); CREATE INDEX "CN_nurse_id_idx" ON "ConsultationNote"("nurse_id"); CREATE INDEX "CN_did_cat_idx" ON "ConsultationNote"("doctorId","createdAt" DESC); CREATE INDEX "CN_pid_cat_idx" ON "ConsultationNote"("patient_id","createdAt" DESC); CREATE INDEX "CN_session_idx" ON "ConsultationNote"("consultation_session_id");
CREATE TABLE "ConsultationSessionAudit" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"consultation_session_id" TEXT NOT NULL,"actor_user_id" TEXT,"actor_role" "UserRole","action" TEXT NOT NULL,"previous_status" "SessionStatus","new_status" "SessionStatus","metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "CSA_session_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE,CONSTRAINT "CSA_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE INDEX "CSA_tenantId_idx" ON "ConsultationSessionAudit"("tenantId"); CREATE INDEX "CSA_session_idx" ON "ConsultationSessionAudit"("consultation_session_id"); CREATE INDEX "CSA_actor_idx" ON "ConsultationSessionAudit"("actor_user_id"); CREATE INDEX "CSA_created_idx" ON "ConsultationSessionAudit"("created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 4D: tenant_demo_app (struktur sama)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA tenant_demo_app;
SET search_path TO tenant_demo_app, public;

-- Enums dibuat unqualified → land di tenant_demo_app
CREATE TYPE "UserRole"         AS ENUM ('DOCTOR', 'ADMIN', 'PATIENT', 'NURSE');
CREATE TYPE "OAuthProvider"    AS ENUM ('GOOGLE', 'MICROSOFT');
CREATE TYPE "SessionType"      AS ENUM ('SCHEDULED', 'INSTANT');
CREATE TYPE "ConsultationMode" AS ENUM ('VIDEO', 'VOICE');
CREATE TYPE "SessionStatus"    AS ENUM ('CREATED', 'IN_CALL', 'COMPLETED', 'FAILED');
CREATE TYPE "AuthAction"       AS ENUM ('REGISTER', 'LOGIN', 'LOGOUT', 'REFRESH', 'TOKEN_REVOKE');

CREATE TABLE "User" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"role" "UserRole" NOT NULL,"name" TEXT NOT NULL,"twilioIdentity" TEXT,"isActive" BOOLEAN NOT NULL DEFAULT true,"emailVerifiedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "User_twilioIdentity_tenantId_key" ON "User"("twilioIdentity","tenantId"); CREATE INDEX "User_tenantId_idx" ON "User"("tenantId"); CREATE INDEX "User_tenantId_role_idx" ON "User"("tenantId","role"); CREATE INDEX "User_role_idx" ON "User"("role"); CREATE INDEX "User_isActive_idx" ON "User"("isActive");
CREATE TABLE "DoctorProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"license" TEXT NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "DoctorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "DoctorProfile_email_tenantId_key" ON "DoctorProfile"("email","tenantId"); CREATE UNIQUE INDEX "DoctorProfile_phone_tenantId_key" ON "DoctorProfile"("phone","tenantId"); CREATE UNIQUE INDEX "DoctorProfile_license_tenantId_key" ON "DoctorProfile"("license","tenantId"); CREATE INDEX "DoctorProfile_tenantId_idx" ON "DoctorProfile"("tenantId"); CREATE INDEX "DoctorProfile_license_idx" ON "DoctorProfile"("license");
CREATE TABLE "AdminProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"adminId" TEXT NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "AdminProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "AdminProfile_email_tenantId_key" ON "AdminProfile"("email","tenantId"); CREATE UNIQUE INDEX "AdminProfile_phone_tenantId_key" ON "AdminProfile"("phone","tenantId"); CREATE UNIQUE INDEX "AdminProfile_adminId_tenantId_key" ON "AdminProfile"("adminId","tenantId"); CREATE INDEX "AdminProfile_tenantId_idx" ON "AdminProfile"("tenantId"); CREATE INDEX "AdminProfile_adminId_idx" ON "AdminProfile"("adminId");
CREATE TABLE "PatientProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"bornDate" TIMESTAMP(3) NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "PatientProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "PatientProfile_email_tenantId_key" ON "PatientProfile"("email","tenantId"); CREATE UNIQUE INDEX "PatientProfile_phone_tenantId_key" ON "PatientProfile"("phone","tenantId"); CREATE INDEX "PatientProfile_tenantId_idx" ON "PatientProfile"("tenantId");
CREATE TABLE "NurseProfile" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL UNIQUE,"fullName" TEXT NOT NULL,"email" TEXT NOT NULL,"phone" TEXT NOT NULL,"passwordHash" TEXT,"nurseId" TEXT NOT NULL,"profilePicture" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "NurseProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "NurseProfile_email_tenantId_key" ON "NurseProfile"("email","tenantId"); CREATE UNIQUE INDEX "NurseProfile_phone_tenantId_key" ON "NurseProfile"("phone","tenantId"); CREATE UNIQUE INDEX "NurseProfile_nurseId_tenantId_key" ON "NurseProfile"("nurseId","tenantId"); CREATE INDEX "NurseProfile_tenantId_idx" ON "NurseProfile"("tenantId"); CREATE INDEX "NurseProfile_nurseId_idx" ON "NurseProfile"("nurseId");
CREATE TABLE "OAuthAccount" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"provider" "OAuthProvider" NOT NULL,"providerUserId" TEXT NOT NULL,"email" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE UNIQUE INDEX "OAuthAccount_provider_providerUserId_tenantId_key" ON "OAuthAccount"("provider","providerUserId","tenantId"); CREATE INDEX "OAuthAccount_tenantId_idx" ON "OAuthAccount"("tenantId"); CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");
CREATE TABLE "RefreshToken" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"tokenHash" TEXT NOT NULL UNIQUE,"userAgent" TEXT,"ip" TEXT,"revokedAt" TIMESTAMP(3),"replacedByTokenId" TEXT UNIQUE,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,CONSTRAINT "RefreshToken_replacedByTokenId_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES "RefreshToken"("id"));
CREATE INDEX "RefreshToken_tenantId_idx" ON "RefreshToken"("tenantId"); CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId"); CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt"); CREATE INDEX "RefreshToken_revokedAt_idx" ON "RefreshToken"("revokedAt");
CREATE TABLE "PendingEmailChange" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"newEmail" TEXT NOT NULL,"tokenHash" TEXT NOT NULL UNIQUE,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "PendingEmailChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE INDEX "PendingEmailChange_tenantId_idx" ON "PendingEmailChange"("tenantId"); CREATE INDEX "PendingEmailChange_userId_idx" ON "PendingEmailChange"("userId"); CREATE INDEX "PendingEmailChange_expiresAt_idx" ON "PendingEmailChange"("expiresAt"); CREATE INDEX "PendingEmailChange_newEmail_idx" ON "PendingEmailChange"("newEmail");
CREATE TABLE "PendingPasswordReset" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT NOT NULL,"tokenHash" TEXT NOT NULL UNIQUE,"expiresAt" TIMESTAMP(3) NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "PendingPasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE);
CREATE INDEX "PendingPasswordReset_tenantId_idx" ON "PendingPasswordReset"("tenantId"); CREATE INDEX "PendingPasswordReset_userId_idx" ON "PendingPasswordReset"("userId"); CREATE INDEX "PendingPasswordReset_expiresAt_idx" ON "PendingPasswordReset"("expiresAt");
CREATE TABLE "LicenseWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"license" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "LicenseWhitelist_license_tenantId_key" ON "LicenseWhitelist"("license","tenantId"); CREATE INDEX "LicenseWhitelist_tenantId_idx" ON "LicenseWhitelist"("tenantId");
CREATE TABLE "AdminIdWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"adminId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "AdminIdWhitelist_adminId_tenantId_key" ON "AdminIdWhitelist"("adminId","tenantId"); CREATE INDEX "AdminIdWhitelist_tenantId_idx" ON "AdminIdWhitelist"("tenantId");
CREATE TABLE "NurseIdWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"nurseId" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "NurseIdWhitelist_nurseId_tenantId_key" ON "NurseIdWhitelist"("nurseId","tenantId"); CREATE INDEX "NurseIdWhitelist_tenantId_idx" ON "NurseIdWhitelist"("tenantId");
CREATE TABLE "MrnWhitelist" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"mrn" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE UNIQUE INDEX "MrnWhitelist_mrn_tenantId_key" ON "MrnWhitelist"("mrn","tenantId"); CREATE INDEX "MrnWhitelist_tenantId_idx" ON "MrnWhitelist"("tenantId");
CREATE TABLE "AuthAuditLog" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"userId" TEXT,"email" TEXT,"action" "AuthAction" NOT NULL,"success" BOOLEAN NOT NULL DEFAULT false,"ip" TEXT,"userAgent" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AuthAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE INDEX "AuthAuditLog_tenantId_idx" ON "AuthAuditLog"("tenantId"); CREATE INDEX "AuthAuditLog_tenantId_createdAt_idx" ON "AuthAuditLog"("tenantId","createdAt"); CREATE INDEX "AuthAuditLog_userId_idx" ON "AuthAuditLog"("userId"); CREATE INDEX "AuthAuditLog_action_idx" ON "AuthAuditLog"("action"); CREATE INDEX "AuthAuditLog_createdAt_idx" ON "AuthAuditLog"("createdAt");
CREATE TABLE "ConsultationSession" ("session_id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"patient_id" TEXT NOT NULL,"doctor_id" TEXT NOT NULL,"session_type" "SessionType" NOT NULL,"consultation_mode" "ConsultationMode" NOT NULL,"scheduled_date" DATE NOT NULL,"scheduled_start_time" TIMESTAMP(3) NOT NULL,"duration_minutes" INTEGER,"scheduled_end_time" TIMESTAMP(3),"session_status" "SessionStatus" NOT NULL DEFAULT 'CREATED',"created_by" TEXT NOT NULL,"nurse_id" TEXT,"room_name" TEXT NOT NULL,"twilio_room_sid" TEXT,"doctor_identity" TEXT,"patient_identity" TEXT,"patient_name" TEXT,"patient_country_code" TEXT,"patient_country" TEXT,"patient_province" TEXT,"patient_city" TEXT,"patient_latitude" DOUBLE PRECISION,"patient_longitude" DOUBLE PRECISION,"nurse_joined_at" TIMESTAMP(3),"nurse_identity" TEXT,"doctor_joined_at" TIMESTAMP(3),"patient_joined_at" TIMESTAMP(3),"started_at" TIMESTAMP(3),"ended_at" TIMESTAMP(3),"recording_enabled" BOOLEAN NOT NULL DEFAULT false,"recording_status" TEXT,"recording_started_at" TIMESTAMP(3),"recording_completed_at" TIMESTAMP(3),"composition_sid" TEXT,"composition_status" TEXT,"composition_started_at" TIMESTAMP(3),"composition_ready_at" TIMESTAMP(3),"media_url" TEXT,"media_format" TEXT,"duration_sec" INTEGER,"error_message" TEXT,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updated_at" TIMESTAMP(3) NOT NULL,CONSTRAINT "CS_patient_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CS_doctor_fkey" FOREIGN KEY ("doctor_id") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CS_creator_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CS_nurse_fkey" FOREIGN KEY ("nurse_id") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE UNIQUE INDEX "CS_room_name_tenantId_key" ON "ConsultationSession"("room_name","tenantId"); CREATE UNIQUE INDEX "CS_twilio_room_sid_tenantId_key" ON "ConsultationSession"("twilio_room_sid","tenantId"); CREATE UNIQUE INDEX "CS_composition_sid_tenantId_key" ON "ConsultationSession"("composition_sid","tenantId"); CREATE INDEX "CS_tenantId_idx" ON "ConsultationSession"("tenantId"); CREATE INDEX "CS_tid_did_sst_idx" ON "ConsultationSession"("tenantId","doctor_id","scheduled_start_time"); CREATE INDEX "CS_tid_pid_sst_idx" ON "ConsultationSession"("tenantId","patient_id","scheduled_start_time"); CREATE INDEX "CS_doctor_id_idx" ON "ConsultationSession"("doctor_id"); CREATE INDEX "CS_patient_id_idx" ON "ConsultationSession"("patient_id"); CREATE INDEX "CS_nurse_id_idx" ON "ConsultationSession"("nurse_id"); CREATE INDEX "CS_created_by_idx" ON "ConsultationSession"("created_by"); CREATE INDEX "CS_status_idx" ON "ConsultationSession"("session_status"); CREATE INDEX "CS_sst_idx" ON "ConsultationSession"("scheduled_start_time"); CREATE INDEX "CS_set_idx" ON "ConsultationSession"("scheduled_end_time"); CREATE INDEX "CS_did_sst_idx" ON "ConsultationSession"("doctor_id","scheduled_start_time"); CREATE INDEX "CS_pid_sst_idx" ON "ConsultationSession"("patient_id","scheduled_start_time"); CREATE INDEX "CS_nid_sst_idx" ON "ConsultationSession"("nurse_id","scheduled_start_time");
CREATE TABLE "ConsultationNote" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"consultation_session_id" TEXT NOT NULL UNIQUE,"doctorId" TEXT NOT NULL,"patient_id" TEXT NOT NULL,"nurse_id" TEXT,"transcriptRaw" TEXT,"summary" TEXT,"subjective" TEXT,"objective" TEXT,"assessment" TEXT,"plan" TEXT,"aiStatus" TEXT,"aiError" TEXT,"is_finalized" BOOLEAN NOT NULL DEFAULT false,"finalized_at" TIMESTAMP(3),"transcribedAt" TIMESTAMP(3),"summarizedAt" TIMESTAMP(3),"aiModel" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "CN_session_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE,CONSTRAINT "CN_doctor_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CN_patient_fkey" FOREIGN KEY ("patient_id") REFERENCES "User"("id") ON DELETE RESTRICT,CONSTRAINT "CN_nurse_fkey" FOREIGN KEY ("nurse_id") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE INDEX "CN_tenantId_idx" ON "ConsultationNote"("tenantId"); CREATE INDEX "CN_doctorId_idx" ON "ConsultationNote"("doctorId"); CREATE INDEX "CN_patient_id_idx" ON "ConsultationNote"("patient_id"); CREATE INDEX "CN_nurse_id_idx" ON "ConsultationNote"("nurse_id"); CREATE INDEX "CN_did_cat_idx" ON "ConsultationNote"("doctorId","createdAt" DESC); CREATE INDEX "CN_pid_cat_idx" ON "ConsultationNote"("patient_id","createdAt" DESC); CREATE INDEX "CN_session_idx" ON "ConsultationNote"("consultation_session_id");
CREATE TABLE "ConsultationSessionAudit" ("id" TEXT PRIMARY KEY,"tenantId" TEXT NOT NULL,"consultation_session_id" TEXT NOT NULL,"actor_user_id" TEXT,"actor_role" "UserRole","action" TEXT NOT NULL,"previous_status" "SessionStatus","new_status" "SessionStatus","metadata" JSONB,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "CSA_session_fkey" FOREIGN KEY ("consultation_session_id") REFERENCES "ConsultationSession"("session_id") ON DELETE CASCADE,CONSTRAINT "CSA_actor_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL);
CREATE INDEX "CSA_tenantId_idx" ON "ConsultationSessionAudit"("tenantId"); CREATE INDEX "CSA_session_idx" ON "ConsultationSessionAudit"("consultation_session_id"); CREATE INDEX "CSA_actor_idx" ON "ConsultationSessionAudit"("actor_user_id"); CREATE INDEX "CSA_created_idx" ON "ConsultationSessionAudit"("created_at");

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFIKASI
-- ─────────────────────────────────────────────────────────────────────────────
SET search_path TO public;

DO $$
DECLARE v_tenants INT;
BEGIN
  SELECT COUNT(*) INTO v_tenants FROM public.tenant_registry;
  RAISE NOTICE '=== DONE ===';
  RAISE NOTICE 'tenant_registry: % tenants', v_tenants;
  RAISE NOTICE 'Schemas: tenant_dharmanugraha, tenant_darramedika, tenant_counseling, tenant_demo_app';
  IF v_tenants <> 4 THEN RAISE EXCEPTION 'GAGAL: expected 4 tenants'; END IF;
  RAISE NOTICE 'OK: Database siap!';
END $$;
