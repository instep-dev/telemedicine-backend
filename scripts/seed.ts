import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const TENANT_ID = "880b1733-15ce-74a7-da49-779988773333";
const TENANT_SLUG = "demo-app";

// Second arg { schema } is the official PrismaPg API to target a specific PostgreSQL schema
const adapter = new PrismaPg(
  { connectionString: process.env.DATABASE_URL! },
  { schema: "tenant_demo_app" },
);

const prisma = new PrismaClient({ adapter });

// ─── Seed data ────────────────────────────────────────────────────────────────
const LICENSES = [
  "12345/SIP-1/2026",
  "23456/SIP-2/2026",
  "34567/SIP-3/2026",
  "45678/SIP-4/2026",
  "56789/SIP-5/2026",
  "67890/SIP-6/2026",
  "78901/SIP-7/2026",
  "89012/SIP-8/2026",
  "90123/SIP-9/2026",
  "01234/SIP-10/2026",
];

const ADMIN_IDS = [
  "101-2024-001",
  "101-2024-002",
  "101-2024-003",
  "101-2024-004",
  "101-2024-005",
  "101-2024-006",
  "101-2024-007",
  "101-2024-008",
  "101-2024-009",
  "101-2024-010",
];

const MRNS = [
  "12-34-56",
  "99-77-70",
  "01-23-45",
  "67-89-00",
  "10-20-30",
  "11-22-33",
  "44-55-66",
  "77-88-99",
  "98-76-54",
  "55-44-33",
];

const NURSE_IDS = [
  "2026040101",
  "2026040102",
  "2026040103",
  "2026040104",
  "2026040105",
  "2026040106",
  "2026040107",
  "2026040108",
  "2026040109",
  "2026040110",
];

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Seeding tenant: ${TENANT_SLUG} (tenant_demo_app)`);

  // Public schema tables — raw SQL with explicit schema since adapter is scoped to tenant schema
  await prisma.$executeRaw`DELETE FROM "public"."PendingRegistration" WHERE "tenantSlug" = ${TENANT_SLUG}`;

  // Tenant schema tables — Prisma model API works because adapter is scoped to tenant_demo_app
  await prisma.$transaction(async (tx) => {
    await tx.consultationSessionAudit.deleteMany();
    await tx.consultationNote.deleteMany();
    await tx.consultationSession.deleteMany();
    await tx.authAuditLog.deleteMany();
    await tx.pendingEmailChange.deleteMany();
    await tx.pendingPasswordReset.deleteMany();
    await tx.refreshToken.deleteMany();
    await tx.doctorProfile.deleteMany();
    await tx.adminProfile.deleteMany();
    await tx.patientProfile.deleteMany();
    await tx.nurseProfile.deleteMany();
    await tx.user.deleteMany();
    await tx.licenseWhitelist.deleteMany();
    await tx.adminIdWhitelist.deleteMany();
    await tx.mrnWhitelist.deleteMany();
    await tx.nurseIdWhitelist.deleteMany();
  });

  // Insert whitelists
  await prisma.$transaction(async (tx) => {
    await tx.licenseWhitelist.createMany({
      data: LICENSES.map((license) => ({ tenantId: TENANT_ID, license })),
    });

    await tx.adminIdWhitelist.createMany({
      data: ADMIN_IDS.map((adminId) => ({ tenantId: TENANT_ID, adminId })),
    });

    await tx.mrnWhitelist.createMany({
      data: MRNS.map((mrn) => ({ tenantId: TENANT_ID, mrn })),
    });

    await tx.nurseIdWhitelist.createMany({
      data: NURSE_IDS.map((nurseId) => ({ tenantId: TENANT_ID, nurseId })),
    });
  });

  console.log("Seed selesai");
  console.log(`License whitelist : ${LICENSES.length} item`);
  console.log(`Admin ID whitelist: ${ADMIN_IDS.length} item`);
  console.log(`MRN whitelist     : ${MRNS.length} item`);
  console.log(`Nurse ID whitelist: ${NURSE_IDS.length} item`);
}

main()
  .catch((e) => {
    console.error("Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
