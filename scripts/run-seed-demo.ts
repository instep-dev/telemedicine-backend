// /**
//  * Jalankan seed-demo.sql ke NeonDB.
//  * Script ini otomatis:
//  *   1. Buat tenant demo-app di tenant_registry (kalau belum ada)
//  *   2. Buat schema tenant_demo_app + semua tabelnya (kalau belum ada)
//  *   3. Jalankan DO block seed (users + sessions + notes)
//  *
//  * Usage:
//  *   bun run scripts/run-seed-demo.ts "postgresql://user:pass@host/db?sslmode=require"
//  */

// import { Client } from "pg";
// import { readFileSync } from "fs";
// import { join } from "path";
// import { getTenantSchemaDDL } from "../src/super-admin/tenant-schema.template";

// const connectionString = process.argv[2] ?? process.env.DATABASE_URL;

// if (!connectionString) {
//   console.error("ERROR: Connection string tidak ditemukan.");
//   console.error(
//     'Usage: bun run scripts/run-seed-demo.ts "postgresql://user:pass@host/db?sslmode=require"'
//   );
//   process.exit(1);
// }

// const TENANT_SLUG   = "demo-app";
// const TENANT_NAME   = "demo Instep";
// const SCHEMA_NAME   = "tenant_demo_app";

// const sqlPath = join(import.meta.dir, "../prisma/seed-demo.sql");
// const fullSql = readFileSync(sqlPath, "utf-8");

// // Pisahkan preamble (CREATE EXTENSION + SET search_path) dari DO block
// const [preamble, doBlock] = fullSql.split(/(?=DO \$\$)/);

// console.log("=".repeat(60));
// console.log("  InStep Telemedicine — Demo Seed Runner");
// console.log("=".repeat(60));
// console.log(`Target: ${connectionString.replace(/:[^:@]+@/, ":***@")}\n`);

// const client = new Client({
//   connectionString,
//   statement_timeout: 0,
//   query_timeout: 0,
// });

// client.on("notice", (msg) => console.log("[PG]", msg.message));

// try {
//   console.log("Connecting...");
//   await client.connect();
//   console.log("Connected.\n");

//   // ── STEP 1: Pastikan pgcrypto tersedia ─────────────────────────────────────
//   console.log("Step 1/4 — CREATE EXTENSION pgcrypto...");
//   await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
//   console.log("  OK\n");

//   // ── STEP 2: Pastikan tenant_demo_app schema ada ────────────────────────────
//   console.log("Step 2/4 — Provisioning schema tenant_demo_app...");
//   const schemaExists = await client.query(
//     `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
//     [SCHEMA_NAME]
//   );

//   if (schemaExists.rowCount === 0) {
//     console.log("  Schema belum ada, membuat...");
//     const ddlStatements = getTenantSchemaDDL(SCHEMA_NAME);
//     for (const stmt of ddlStatements) {
//       await client.query(stmt);
//     }
//     console.log(`  Schema "${SCHEMA_NAME}" + semua tabel dibuat.\n`);
//   } else {
//     console.log(`  Schema "${SCHEMA_NAME}" sudah ada, skip.\n`);
//   }

//   // ── STEP 3: Pastikan tenant ada di tenant_registry ─────────────────────────
//   console.log("Step 3/4 — Provisioning tenant di tenant_registry...");
//   const tenantExists = await client.query(
//     `SELECT id FROM public.tenant_registry WHERE slug = $1`,
//     [TENANT_SLUG]
//   );

//   if (tenantExists.rowCount === 0) {
//     console.log("  Tenant belum ada, insert...");
//     await client.query(
//       `INSERT INTO public.tenant_registry
//          (id, slug, name, schema_name, status, created_at, updated_at)
//        VALUES
//          (gen_random_uuid()::text, $1, $2, $3, 'active', NOW(), NOW())`,
//       [TENANT_SLUG, TENANT_NAME, SCHEMA_NAME]
//     );
//     console.log(`  Tenant "${TENANT_SLUG}" dibuat.\n`);
//   } else {
//     console.log(`  Tenant "${TENANT_SLUG}" sudah ada (id: ${tenantExists.rows[0].id}), skip.\n`);
//   }

//   // ── STEP 4: Jalankan DO block seed ─────────────────────────────────────────
//   console.log("Step 4/4 — Running seed DO block...");
//   console.log("  SET search_path...");
//   await client.query(`SET search_path TO ${SCHEMA_NAME}, public`);

//   console.log("  Inserting 100 patients, 100 doctors, 100 nurses, 50 admins...");
//   console.log("  Inserting 10000 sessions + 8000 notes...");
//   console.log("  Ini butuh beberapa menit, harap tunggu...\n");

//   const start = Date.now();
//   await client.query(doBlock);
//   const elapsed = ((Date.now() - start) / 1000).toFixed(1);

//   console.log(`\n  Selesai dalam ${elapsed} detik.`);
//   console.log("\n" + "=".repeat(60));
//   console.log("  SEED BERHASIL!");
//   console.log("=".repeat(60));
//   console.log("  Login admin : admin1@staff.demo.com");
//   console.log("  Login dokter: dokter1@staff.demo.com");
//   console.log("  Login pasien: ahmad.santoso1@patient.demo.com");
//   console.log("  Password    : Password123!");
//   console.log("=".repeat(60));

// } catch (err: any) {
//   console.error("\n[ERROR]", err.message ?? err);
//   if (err.detail)   console.error("[DETAIL]", err.detail);
//   if (err.hint)     console.error("[HINT]",   err.hint);
//   if (err.position) console.error("[POSITION]", err.position);
//   process.exit(1);
// } finally {
//   await client.end();
// }
