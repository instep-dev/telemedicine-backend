-- ═══════════════════════════════════════════════════════════════════════════════
-- SUPER ADMIN TABLE SETUP
-- Jalankan sekali di public schema setelah multitenant-migration.sql
-- ═══════════════════════════════════════════════════════════════════════════════

SET search_path TO public;

CREATE TABLE IF NOT EXISTS public."SuperAdmin" (
  "id"           TEXT         PRIMARY KEY,
  "email"        TEXT         NOT NULL UNIQUE,
  "name"         TEXT         NOT NULL,
  "passwordHash" TEXT         NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "SuperAdmin_email_idx" ON public."SuperAdmin"("email");

CREATE TABLE IF NOT EXISTS public."SuperAdminRefreshToken" (
  "id"                TEXT         PRIMARY KEY,
  "superAdminId"      TEXT         NOT NULL,
  "tokenHash"         TEXT         NOT NULL UNIQUE,
  "userAgent"         TEXT,
  "ip"                TEXT,
  "revokedAt"         TIMESTAMP(3),
  "replacedByTokenId" TEXT         UNIQUE,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SuperAdminRefreshToken_superAdminId_fkey"
    FOREIGN KEY ("superAdminId") REFERENCES public."SuperAdmin"("id") ON DELETE CASCADE,
  CONSTRAINT "SuperAdminRefreshToken_replacedByTokenId_fkey"
    FOREIGN KEY ("replacedByTokenId") REFERENCES public."SuperAdminRefreshToken"("id")
);

CREATE INDEX IF NOT EXISTS "SART_superAdminId_idx" ON public."SuperAdminRefreshToken"("superAdminId");
CREATE INDEX IF NOT EXISTS "SART_expiresAt_idx"    ON public."SuperAdminRefreshToken"("expiresAt");
