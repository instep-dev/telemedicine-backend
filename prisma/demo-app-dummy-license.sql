-- ═══════════════════════════════════════════════════════════════════════════════
-- DEMO APP WHITELIST SEED
-- Schema: tenant_demo_app
-- Tenant ID: 880b1733-15ce-74a7-da49-779988773333
-- Paste ke pgAdmin Query Tool → F5
-- Aman dijalankan berulang kali (ON CONFLICT DO NOTHING)
-- ═══════════════════════════════════════════════════════════════════════════════

SET search_path TO tenant_demo_app, public;

-- ─────────────────────────────────────────────────────────────────────────────
-- LicenseWhitelist (10 SIP licenses)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "LicenseWhitelist" ("id", "tenantId", "license", "createdAt")
VALUES
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '12345/SIP-1/2026',  NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '23456/SIP-2/2026',  NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '34567/SIP-3/2026',  NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '45678/SIP-4/2026',  NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '56789/SIP-5/2026',  NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '67890/SIP-6/2026',  NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '78901/SIP-7/2026',  NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '89012/SIP-8/2026',  NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '90123/SIP-9/2026',  NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '01234/SIP-10/2026', NOW())
ON CONFLICT ("license", "tenantId") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- AdminIdWhitelist (10 admin IDs)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "AdminIdWhitelist" ("id", "tenantId", "adminId", "createdAt")
VALUES
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-001', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-002', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-003', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-004', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-005', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-006', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-007', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-008', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-009', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '101-2024-010', NOW())
ON CONFLICT ("adminId", "tenantId") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- NurseIdWhitelist (10 nurse IDs)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "NurseIdWhitelist" ("id", "tenantId", "nurseId", "createdAt")
VALUES
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040101', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040102', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040103', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040104', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040105', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040106', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040107', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040108', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040109', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '2026040110', NOW())
ON CONFLICT ("nurseId", "tenantId") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- MrnWhitelist (10 MRN patient codes)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "MrnWhitelist" ("id", "tenantId", "mrn", "createdAt")
VALUES
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '12-34-56', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '99-77-70', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '01-23-45', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '67-89-00', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '10-20-30', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '11-22-33', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '44-55-66', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '77-88-99', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '98-76-54', NOW()),
  (gen_random_uuid()::text, '880b1733-15ce-74a7-da49-779988773333', '55-44-33', NOW())
ON CONFLICT ("mrn", "tenantId") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verifikasi
-- ─────────────────────────────────────────────────────────────────────────────

SELECT 'LicenseWhitelist'  AS table_name, COUNT(*) AS total FROM "LicenseWhitelist"  WHERE "tenantId" = '880b1733-15ce-74a7-da49-779988773333'
UNION ALL
SELECT 'AdminIdWhitelist'  AS table_name, COUNT(*) AS total FROM "AdminIdWhitelist"  WHERE "tenantId" = '880b1733-15ce-74a7-da49-779988773333'
UNION ALL
SELECT 'NurseIdWhitelist'  AS table_name, COUNT(*) AS total FROM "NurseIdWhitelist"  WHERE "tenantId" = '880b1733-15ce-74a7-da49-779988773333'
UNION ALL
SELECT 'MrnWhitelist'      AS table_name, COUNT(*) AS total FROM "MrnWhitelist"      WHERE "tenantId" = '880b1733-15ce-74a7-da49-779988773333';
