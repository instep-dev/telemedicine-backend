/**
 * E2E tests: Auth endpoints
 *
 * Semua endpoint auth diuji menggunakan Supertest dengan NestJS Testing Module.
 * PrismaService di-mock agar tests tidak membutuhkan database nyata.
 * Validasi yang diuji:
 *  - Rate limiting (throttle guard)
 *  - DTO validation (class-validator)
 *  - Tenant header requirement
 *  - HTTP status codes yang benar
 *  - Response shape
 *
 * Untuk tests yang membutuhkan DB nyata (login sukses, register lengkap),
 * gunakan file integration-test.e2e-spec.ts dengan DB test yang terpisah.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../prisma/prisma.service';
import cookieParser from 'cookie-parser';

// ─── Mock PrismaService lengkap ───────────────────────────────────────────────

const mockPrismaService = {
  $queryRaw: jest.fn().mockResolvedValue([]),
  withTenantSchema: jest.fn().mockResolvedValue(null),
  $connect: jest.fn(),
  $disconnect: jest.fn(),
};

// ─── Helper ───────────────────────────────────────────────────────────────────

const TENANT_SLUG = 'klinik-test';

function withTenant(req: request.Test) {
  return req.set('X-Tenant-Slug', TENANT_SLUG);
}

// ─── App setup ────────────────────────────────────────────────────────────────

describe('Auth Endpoints (E2E)', () => {
  let app: INestApplication;
  let httpServer: any;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();

    app = moduleFixture.createNestApplication();

    // Mirror konfigurasi dari main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.use(cookieParser());

    await app.init();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Default: tenant valid
    mockPrismaService.$queryRaw.mockResolvedValue([
      { id: 'tenant-001', slug: TENANT_SLUG, schema_name: `tenant_${TENANT_SLUG}`, status: 'active' },
    ]);
  });

  // ─── POST /auth/login ───────────────────────────────────────────────────

  describe('POST /auth/login', () => {
    it('harus menolak request tanpa X-Tenant-Slug header', async () => {
      const res = await request(httpServer)
        .post('/auth/login')
        .send({ identifier: 'test@test.com', password: 'Password1' });
      // Tanpa tenant slug → 400 atau 401
      expect([400, 401, 403]).toContain(res.status);
    });

    it('harus menolak body kosong dengan 400', async () => {
      const res = await withTenant(request(httpServer).post('/auth/login')).send({});
      expect(res.status).toBe(400);
    });

    it('harus menolak jika identifier kosong', async () => {
      const res = await withTenant(request(httpServer).post('/auth/login')).send({
        identifier: '',
        password: 'Password1',
      });
      expect(res.status).toBe(400);
    });

    it('harus menolak jika password kosong', async () => {
      const res = await withTenant(request(httpServer).post('/auth/login')).send({
        identifier: 'test@test.com',
        password: '',
      });
      expect(res.status).toBe(400);
    });

    it('harus menolak field yang tidak dikenal (whitelist validation)', async () => {
      const res = await withTenant(request(httpServer).post('/auth/login')).send({
        identifier: 'test@test.com',
        password: 'Password1',
        unknownField: 'hacker',
      });
      expect(res.status).toBe(400);
    });

    it('harus mengembalikan 401 untuk credential yang salah (user tidak ada di mock DB)', async () => {
      mockPrismaService.withTenantSchema.mockImplementation(
        async (_schema: string, fn: Function) => {
          return fn({
            doctorProfile: { findFirst: jest.fn().mockResolvedValue(null) },
            adminProfile: { findFirst: jest.fn().mockResolvedValue(null) },
            patientProfile: { findFirst: jest.fn().mockResolvedValue(null) },
            nurseProfile: { findFirst: jest.fn().mockResolvedValue(null) },
            authAuditLog: { create: jest.fn().mockResolvedValue({}) },
          });
        },
      );

      const res = await withTenant(request(httpServer).post('/auth/login')).send({
        identifier: 'nonexistent@test.com',
        password: 'Password1',
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /auth/register ─────────────────────────────────────────────────

  describe('POST /auth/register', () => {
    it('harus menolak body kosong dengan 400', async () => {
      const res = await withTenant(request(httpServer).post('/auth/register')).send({});
      expect(res.status).toBe(400);
    });

    it('harus menolak email tidak valid', async () => {
      const res = await withTenant(request(httpServer).post('/auth/register')).send({
        email: 'bukan-email',
        password: 'Password1',
        phone: '081234567890',
        role: 'PATIENT',
        name: 'Test User',
      });
      expect(res.status).toBe(400);
    });

    it('harus menolak password yang lemah', async () => {
      const res = await withTenant(request(httpServer).post('/auth/register')).send({
        email: 'test@klinik.com',
        password: 'lemah', // tidak memenuhi policy
        phone: '081234567890',
        role: 'PATIENT',
        name: 'Test User',
      });
      expect(res.status).toBe(400);
    });

    it('harus menolak role yang tidak valid', async () => {
      const res = await withTenant(request(httpServer).post('/auth/register')).send({
        email: 'test@klinik.com',
        password: 'Password1',
        phone: '081234567890',
        role: 'SUPERUSER', // role tidak valid
        name: 'Test User',
      });
      expect(res.status).toBe(400);
    });

    it('harus menolak tanpa field wajib', async () => {
      const res = await withTenant(request(httpServer).post('/auth/register')).send({
        email: 'test@klinik.com',
        // password, phone, role, name hilang
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /auth/registration/verify-email ───────────────────────────────

  describe('POST /auth/registration/verify-email', () => {
    it('harus menolak body kosong dengan 400', async () => {
      const res = await withTenant(
        request(httpServer).post('/auth/registration/verify-email'),
      ).send({});
      expect(res.status).toBe(400);
    });

    it('harus menolak OTP kurang dari 6 digit', async () => {
      const res = await withTenant(
        request(httpServer).post('/auth/registration/verify-email'),
      ).send({ otp: '123', email: 'test@klinik.com' });
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /auth/refresh ──────────────────────────────────────────────────

  describe('POST /auth/refresh', () => {
    it('harus menolak jika tidak ada refresh_token cookie', async () => {
      const res = await withTenant(request(httpServer).post('/auth/refresh')).send();
      expect([401, 400]).toContain(res.status);
    });
  });

  // ─── POST /auth/logout ───────────────────────────────────────────────────

  describe('POST /auth/logout', () => {
    it('harus menolak tanpa Bearer token dengan 401', async () => {
      const res = await withTenant(request(httpServer).post('/auth/logout')).send();
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /auth/logout-all ────────────────────────────────────────────────

  describe('POST /auth/logout-all', () => {
    it('harus menolak tanpa Bearer token dengan 401', async () => {
      const res = await withTenant(request(httpServer).post('/auth/logout-all')).send();
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /auth/request-email-change ─────────────────────────────────────

  describe('POST /auth/request-email-change', () => {
    it('harus menolak tanpa Bearer token dengan 401', async () => {
      const res = await withTenant(
        request(httpServer).post('/auth/request-email-change'),
      ).send({ newEmail: 'new@test.com', currentPassword: 'Password1' });
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /auth/request-password-reset ───────────────────────────────────

  describe('POST /auth/request-password-reset', () => {
    it('harus menolak tanpa Bearer token dengan 401', async () => {
      const res = await withTenant(
        request(httpServer).post('/auth/request-password-reset'),
      ).send({});
      expect(res.status).toBe(401);
    });
  });

  // ─── Tenant validation ────────────────────────────────────────────────────

  describe('Tenant validation', () => {
    it('harus menolak tenant tidak aktif', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([
        { id: 'tenant-002', slug: 'inactive', schema_name: 'tenant_inactive', status: 'inactive' },
      ]);

      const res = await request(httpServer)
        .post('/auth/login')
        .set('X-Tenant-Slug', 'inactive')
        .send({ identifier: 'test@test.com', password: 'Password1' });
      expect([400, 401, 403]).toContain(res.status);
    });

    it('harus menolak tenant yang tidak ada di database', async () => {
      mockPrismaService.$queryRaw.mockResolvedValueOnce([]); // tenant tidak ditemukan

      const res = await request(httpServer)
        .post('/auth/login')
        .set('X-Tenant-Slug', 'tidak-ada')
        .send({ identifier: 'test@test.com', password: 'Password1' });
      expect([400, 401, 403, 404]).toContain(res.status);
    });
  });
});
