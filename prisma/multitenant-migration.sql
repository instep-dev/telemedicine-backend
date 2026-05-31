-- ═══════════════════════════════════════════════════════════════════════════════
-- CLEAN SLATE SCRIPT — Database kosong total
-- Paste ke pgAdmin / Neon SQL Editor → Run
-- Drops semua → rebuild public schema infrastructure → TIDAK ada data
-- Tenant schema dibuat otomatis via aplikasi saat superAdmin tambah tenant
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 1: DROP EVERYTHING
-- ─────────────────────────────────────────────────────────────────────────────

DROP SCHEMA IF EXISTS tenant_dharmanugraha CASCADE;
DROP SCHEMA IF EXISTS tenant_darramedika   CASCADE;
DROP SCHEMA IF EXISTS tenant_counseling    CASCADE;
DROP SCHEMA IF EXISTS tenant_demo_app      CASCADE;

DROP TABLE IF EXISTS public."SuperAdminRefreshToken" CASCADE;
DROP TABLE IF EXISTS public."SuperAdmin"             CASCADE;
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
-- PHASE 2: ENUMS (public schema)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE public."UserRole"         AS ENUM ('DOCTOR', 'ADMIN', 'PATIENT', 'NURSE');
CREATE TYPE public."OAuthProvider"    AS ENUM ('GOOGLE', 'MICROSOFT');
CREATE TYPE public."SessionType"      AS ENUM ('SCHEDULED', 'INSTANT');
CREATE TYPE public."ConsultationMode" AS ENUM ('VIDEO', 'VOICE');
CREATE TYPE public."SessionStatus"    AS ENUM ('CREATED', 'IN_CALL', 'COMPLETED', 'FAILED');
CREATE TYPE public."AuthAction"       AS ENUM ('REGISTER', 'LOGIN', 'LOGOUT', 'REFRESH', 'TOKEN_REVOKE');

-- ─────────────────────────────────────────────────────────────────────────────
-- PHASE 3: PUBLIC SCHEMA TABLES (semua kosong, tidak ada data)
-- ─────────────────────────────────────────────────────────────────────────────

-- SuperAdmin
CREATE TABLE public."SuperAdmin" (
  "id"           TEXT         PRIMARY KEY,
  "email"        VARCHAR(255) NOT NULL UNIQUE,
  "name"         VARCHAR(255) NOT NULL,
  "passwordHash" TEXT         NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE public."SuperAdminRefreshToken" (
  "id"                TEXT         PRIMARY KEY,
  "superAdminId"      TEXT         NOT NULL,
  "tokenHash"         TEXT         NOT NULL UNIQUE,
  "userAgent"         TEXT,
  "ip"                TEXT,
  "revokedAt"         TIMESTAMP(3),
  "replacedByTokenId" TEXT         UNIQUE,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SART_superAdmin_fkey" FOREIGN KEY ("superAdminId")      REFERENCES public."SuperAdmin"("id") ON DELETE CASCADE,
  CONSTRAINT "SART_replacedBy_fkey" FOREIGN KEY ("replacedByTokenId") REFERENCES public."SuperAdminRefreshToken"("id")
);
CREATE INDEX "SuperAdminRefreshToken_superAdminId_idx" ON public."SuperAdminRefreshToken"("superAdminId");
CREATE INDEX "SuperAdminRefreshToken_expiresAt_idx"    ON public."SuperAdminRefreshToken"("expiresAt");

-- Tenant registry
CREATE TABLE public.tenant_registry (
  id                TEXT         PRIMARY KEY,
  slug              VARCHAR(100) NOT NULL UNIQUE,
  name              VARCHAR(255) NOT NULL,
  schema_name       VARCHAR(100) NOT NULL UNIQUE,
  status            VARCHAR(50)  NOT NULL DEFAULT 'active',
  service_type      TEXT,
  subscription_plan TEXT,
  admin_email       VARCHAR(255),
  contact_phone     VARCHAR(20),
  address           TEXT,
  created_at        TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX tenant_registry_slug_idx   ON public.tenant_registry (slug);
CREATE INDEX tenant_registry_status_idx ON public.tenant_registry (status);

-- OAuth ephemeral tables
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
  "id"             TEXT PRIMARY KEY,
  "tenantSlug"     TEXT NOT NULL,
  "provider"       public."OAuthProvider" NOT NULL,
  "role"           public."UserRole"      NOT NULL,
  "providerUserId" TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "name"           TEXT,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "OAuthPending_provider_providerUserId_tenantSlug_key"
  ON public."OAuthPending"("provider","providerUserId","tenantSlug");
CREATE INDEX "OAuthPending_email_idx"     ON public."OAuthPending"("email");
CREATE INDEX "OAuthPending_expiresAt_idx" ON public."OAuthPending"("expiresAt");

CREATE TABLE public."PendingRegistration" (
  "id"           TEXT PRIMARY KEY,
  "tenantSlug"   TEXT NOT NULL,
  "role"         public."UserRole" NOT NULL,
  "email"        TEXT NOT NULL,
  "phone"        TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "license"      TEXT,
  "adminId"      TEXT,
  "nurseId"      TEXT,
  "bornDate"     TIMESTAMP(3),
  "tokenHash"    TEXT NOT NULL UNIQUE,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PendingRegistration_tenantSlug_idx" ON public."PendingRegistration"("tenantSlug");
CREATE INDEX "PendingRegistration_email_idx"      ON public."PendingRegistration"("email");
CREATE INDEX "PendingRegistration_phone_idx"      ON public."PendingRegistration"("phone");
CREATE INDEX "PendingRegistration_expiresAt_idx"  ON public."PendingRegistration"("expiresAt");

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFIKASI
-- ─────────────────────────────────────────────────────────────────────────────
SET search_path TO public;

DO $$
BEGIN
  RAISE NOTICE '=== CLEAN SLATE SELESAI ===';
  RAISE NOTICE 'Public tables: SuperAdmin, SuperAdminRefreshToken, tenant_registry, OAuthState, OAuthPending, PendingRegistration';
  RAISE NOTICE 'Semua tabel KOSONG — tidak ada data';
  RAISE NOTICE 'Tenant schema akan dibuat otomatis via app saat superAdmin tambah tenant';
  RAISE NOTICE 'Langkah berikutnya: buat akun SuperAdmin via seed script atau langsung di DB';
END $$;
