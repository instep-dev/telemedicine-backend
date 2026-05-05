import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

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

async function main() {
  console.log("? Start seeding...");

  await prisma.oauthAccount.deleteMany();
  await prisma.oauthPending.deleteMany();
  await prisma.oauthState.deleteMany();
  await prisma.pendingRegistration.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.consultationSessionAudit.deleteMany();
  await prisma.consultationNote.deleteMany();
  await prisma.consultationSession.deleteMany();
  await prisma.doctorProfile.deleteMany();
  await prisma.adminProfile.deleteMany();
  await prisma.patientProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.authAuditLog.deleteMany();

  await prisma.nurseProfile.deleteMany();
  await prisma.licenseWhitelist.deleteMany();
  await prisma.adminIdWhitelist.deleteMany();
  await prisma.mrnWhitelist.deleteMany();
  await prisma.nurseIdWhitelist.deleteMany();

  for (const license of LICENSES) {
    await prisma.licenseWhitelist.create({ data: { license } });
  }

  for (const adminId of ADMIN_IDS) {
    await prisma.adminIdWhitelist.create({ data: { adminId } });
  }

  for (const mrn of MRNS) {
    await prisma.mrnWhitelist.create({ data: { mrn } });
  }

  for (const nurseId of NURSE_IDS) {
    await prisma.nurseIdWhitelist.create({ data: { nurseId } });
  }

  console.log("? Seed selesai");
  console.log("? License whitelist: 10 item");
  console.log("? Admin ID whitelist: 10 item");
  console.log("? MRN whitelist: 10 item");
  console.log("? Nurse ID whitelist: 10 item");
}

main()
  .catch((e) => {
    console.error("? Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
