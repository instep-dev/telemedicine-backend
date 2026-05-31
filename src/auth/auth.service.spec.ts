/**
 * Unit tests: Auth Business Logic
 *
 * Fokus pengujian:
 * 1. Password policy validation
 * 2. Email & phone normalization
 * 3. Role parsing
 * 4. Born date parsing & minimum age
 * 5. TTL parsing (JWT expiry string → ms)
 * 6. OTP generation (6-digit numeric)
 * 7. Token security (SHA256 hashing, uniqueness)
 *
 * Tests ini murni menguji business logic tanpa DI container
 * untuk menghindari dependency cycle yang kompleks.
 */

import crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { UserRole, OAuthProvider } from '@prisma/client';

// ─── Pure helpers (direplikasi dari auth.service.ts) ──────────────────────────

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

function sha256(raw: string) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseTtlToMs(ttl: string): number {
  const m = ttl.match(/^(\d+)([smhd])$/);
  if (!m) throw new Error(`Invalid TTL format: ${ttl}`);
  const n = Number(m[1]);
  const unit = m[2];
  const mult =
    unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}

function randomVerificationCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) code += crypto.randomInt(0, 10).toString();
  return code;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '');
}

function ensurePasswordPolicy(password: string) {
  if (!PASSWORD_REGEX.test(password)) {
    throw new BadRequestException(
      'Password minimal 8 karakter, harus ada 1 lowercase, 1 uppercase, dan 1 number',
    );
  }
}

function parseRole(raw: string): UserRole {
  const v = String(raw || '').trim().toUpperCase();
  if (v === 'DOCTOR') return UserRole.DOCTOR;
  if (v === 'ADMIN') return UserRole.ADMIN;
  if (v === 'PATIENT') return UserRole.PATIENT;
  if (v === 'NURSE') return UserRole.NURSE;
  throw new BadRequestException('Role tidak valid');
}

function parseProvider(raw: string): OAuthProvider {
  const v = String(raw || '').trim().toUpperCase();
  if (v === 'GOOGLE') return OAuthProvider.GOOGLE;
  if (v === 'MICROSOFT') return OAuthProvider.MICROSOFT;
  throw new BadRequestException('Provider OAuth tidak valid');
}

function parseBornDate(raw?: string) {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Tanggal lahir tidak valid');
  return d;
}

function ensureMinimumAge(bornDate: Date, minYears: number) {
  const n = new Date();
  const cutoff = new Date(n.getFullYear() - minYears, n.getMonth(), n.getDate());
  if (bornDate > cutoff) throw new BadRequestException(`Minimal umur ${minYears} tahun`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Auth: Business Logic Unit Tests', () => {

  // ─── Password Policy ────────────────────────────────────────────────────

  describe('ensurePasswordPolicy', () => {
    it('harus lolos untuk password valid', () => {
      expect(() => ensurePasswordPolicy('Password1')).not.toThrow();
      expect(() => ensurePasswordPolicy('MySecure@123')).not.toThrow();
      expect(() => ensurePasswordPolicy('Abc12345')).not.toThrow();
    });

    it('harus menolak password < 8 karakter', () => {
      expect(() => ensurePasswordPolicy('Ab1')).toThrow(BadRequestException);
      expect(() => ensurePasswordPolicy('Short1')).toThrow(BadRequestException);
    });

    it('harus menolak password tanpa huruf besar', () => {
      expect(() => ensurePasswordPolicy('password1')).toThrow(BadRequestException);
      expect(() => ensurePasswordPolicy('allsmall123')).toThrow(BadRequestException);
    });

    it('harus menolak password tanpa huruf kecil', () => {
      expect(() => ensurePasswordPolicy('PASSWORD1')).toThrow(BadRequestException);
      expect(() => ensurePasswordPolicy('ALLCAPS123')).toThrow(BadRequestException);
    });

    it('harus menolak password tanpa angka', () => {
      expect(() => ensurePasswordPolicy('PasswordOnly')).toThrow(BadRequestException);
      expect(() => ensurePasswordPolicy('NoNumbers!')).toThrow(BadRequestException);
    });

    it('harus menolak string kosong', () => {
      expect(() => ensurePasswordPolicy('')).toThrow(BadRequestException);
    });

    it('harus lolos password dengan karakter spesial', () => {
      expect(() => ensurePasswordPolicy('P@ssw0rd!')).not.toThrow();
    });

    it('harus lolos password panjang', () => {
      expect(() => ensurePasswordPolicy('VeryLongPassword123WithExtra!')).not.toThrow();
    });
  });

  // ─── Email normalization ─────────────────────────────────────────────────

  describe('normalizeEmail', () => {
    it('harus mengubah uppercase ke lowercase', () => {
      expect(normalizeEmail('DOCTOR@KLINIK.COM')).toBe('doctor@klinik.com');
    });

    it('harus membuang whitespace', () => {
      expect(normalizeEmail('  user@test.com  ')).toBe('user@test.com');
    });

    it('harus menangani mixed case', () => {
      expect(normalizeEmail('Doctor.User@Klinik.ID')).toBe('doctor.user@klinik.id');
    });

    it('harus tidak mengubah email yang sudah lowercase', () => {
      expect(normalizeEmail('user@test.com')).toBe('user@test.com');
    });
  });

  // ─── Phone normalization ─────────────────────────────────────────────────

  describe('normalizePhone', () => {
    it('harus menghapus tanda strip', () => {
      // +62-812-3456-7890 → digits only: 6,2,8,1,2,3,4,5,6,7,8,9,0 = 13 digit
      expect(normalizePhone('+62-812-3456-7890')).toBe('6281234567890');
    });

    it('harus mempertahankan digit saja', () => {
      expect(normalizePhone('081234567890')).toBe('081234567890');
    });

    it('harus menghapus tanda kurung dan spasi', () => {
      expect(normalizePhone('(021) 555-1234')).toBe('0215551234');
    });

    it('harus menghapus semua non-digit', () => {
      expect(normalizePhone('+1 (800) FLOWERS')).toBe('1800');
    });
  });

  // ─── Role parsing ───────────────────────────────────────────────────────

  describe('parseRole', () => {
    it('harus parse semua role valid (case-insensitive)', () => {
      expect(parseRole('DOCTOR')).toBe(UserRole.DOCTOR);
      expect(parseRole('doctor')).toBe(UserRole.DOCTOR);
      expect(parseRole('ADMIN')).toBe(UserRole.ADMIN);
      expect(parseRole('admin')).toBe(UserRole.ADMIN);
      expect(parseRole('PATIENT')).toBe(UserRole.PATIENT);
      expect(parseRole('patient')).toBe(UserRole.PATIENT);
      expect(parseRole('NURSE')).toBe(UserRole.NURSE);
      expect(parseRole('nurse')).toBe(UserRole.NURSE);
    });

    it('harus melempar BadRequestException untuk role tidak valid', () => {
      expect(() => parseRole('SUPERUSER')).toThrow(BadRequestException);
      expect(() => parseRole('GUEST')).toThrow(BadRequestException);
      expect(() => parseRole('')).toThrow(BadRequestException);
      expect(() => parseRole('RECEPTIONIST')).toThrow(BadRequestException);
    });
  });

  // ─── OAuth provider parsing ──────────────────────────────────────────────

  describe('parseProvider', () => {
    it('harus parse GOOGLE', () => {
      expect(parseProvider('GOOGLE')).toBe(OAuthProvider.GOOGLE);
      expect(parseProvider('google')).toBe(OAuthProvider.GOOGLE);
    });

    it('harus parse MICROSOFT', () => {
      expect(parseProvider('MICROSOFT')).toBe(OAuthProvider.MICROSOFT);
      expect(parseProvider('microsoft')).toBe(OAuthProvider.MICROSOFT);
    });

    it('harus melempar BadRequestException untuk provider tidak valid', () => {
      expect(() => parseProvider('LINKEDIN')).toThrow(BadRequestException);
      expect(() => parseProvider('FACEBOOK')).toThrow(BadRequestException);
      expect(() => parseProvider('')).toThrow(BadRequestException);
    });
  });

  // ─── Born date & minimum age ─────────────────────────────────────────────

  describe('parseBornDate & ensureMinimumAge', () => {
    it('harus parse tanggal ISO valid', () => {
      const d = parseBornDate('1990-05-15');
      expect(d).toBeInstanceOf(Date);
      expect(d?.getFullYear()).toBe(1990);
    });

    it('harus mengembalikan null jika tanggal kosong', () => {
      expect(parseBornDate(undefined)).toBeNull();
      expect(parseBornDate('')).toBeNull();
    });

    it('harus melempar error untuk format tidak valid', () => {
      expect(() => parseBornDate('bukan-tanggal')).toThrow(BadRequestException);
      expect(() => parseBornDate('32-13-2000')).toThrow(BadRequestException);
    });

    it('harus lolos untuk pengguna berusia > 17 tahun', () => {
      const bornDate = new Date();
      bornDate.setFullYear(bornDate.getFullYear() - 25);
      expect(() => ensureMinimumAge(bornDate, 17)).not.toThrow();
    });

    it('harus melempar error untuk pengguna berusia < 17 tahun', () => {
      const bornDate = new Date();
      bornDate.setFullYear(bornDate.getFullYear() - 10);
      expect(() => ensureMinimumAge(bornDate, 17)).toThrow(BadRequestException);
    });

    it('harus melempar error untuk bayi (umur 0)', () => {
      expect(() => ensureMinimumAge(new Date(), 17)).toThrow(BadRequestException);
    });
  });

  // ─── TTL parsing ────────────────────────────────────────────────────────

  describe('parseTtlToMs', () => {
    const cases = [
      ['60m', 60 * 60_000],
      ['30d', 30 * 86_400_000],
      ['24h', 24 * 3_600_000],
      ['3600s', 3_600_000],
      ['1d', 86_400_000],
      ['15m', 15 * 60_000],
    ] as const;

    cases.forEach(([ttl, expected]) => {
      it(`harus parse "${ttl}" ke ${expected} ms`, () => {
        expect(parseTtlToMs(ttl)).toBe(expected);
      });
    });

    it('harus melempar error untuk format tidak valid', () => {
      expect(() => parseTtlToMs('invalid')).toThrow();
      expect(() => parseTtlToMs('30')).toThrow();
      expect(() => parseTtlToMs('m30')).toThrow();
      expect(() => parseTtlToMs('')).toThrow();
    });
  });

  // ─── OTP generation ─────────────────────────────────────────────────────

  describe('randomVerificationCode', () => {
    it('harus menghasilkan kode tepat 6 digit', () => {
      const code = randomVerificationCode(6);
      expect(code).toHaveLength(6);
    });

    it('harus hanya mengandung digit 0-9', () => {
      const code = randomVerificationCode(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    it('harus menghasilkan kode yang berbeda setiap kali', () => {
      const codes = new Set(Array.from({ length: 20 }, () => randomVerificationCode(6)));
      expect(codes.size).toBeGreaterThan(1); // Sangat kecil kemungkinan semua sama
    });
  });

  // ─── Token security ──────────────────────────────────────────────────────

  describe('sha256 & randomToken', () => {
    it('SHA256 harus deterministik', () => {
      expect(sha256('same-input')).toBe(sha256('same-input'));
    });

    it('SHA256 harus menghasilkan hash berbeda untuk input berbeda', () => {
      expect(sha256('token-a')).not.toBe(sha256('token-b'));
    });

    it('SHA256 harus menghasilkan hex 64 karakter', () => {
      expect(sha256('test').length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(sha256('test'))).toBe(true);
    });

    it('randomToken harus menghasilkan string unik', () => {
      const tokens = new Set(Array.from({ length: 10 }, () => randomToken(48)));
      expect(tokens.size).toBe(10);
    });

    it('randomToken harus cukup panjang untuk keamanan', () => {
      const token = randomToken(48);
      expect(token.length).toBeGreaterThan(32); // base64url dari 48 bytes > 32 karakter
    });
  });
});
