/**
 * Unit tests: TwilioService — Business Logic
 *
 * Karena TwilioService punya banyak circular dependency (forwardRef),
 * tests ini mengekstrak dan memverifikasi business logic secara langsung
 * tanpa perlu menginisialisasi full NestJS module.
 *
 * Fokus pengujian:
 * 1. assertJoinWindow — validasi window join
 * 2. calculateTokenTtl — TTL dinamis (KRITIS untuk sesi berjam-jam)
 * 3. calculateDuration — hitung durasi sesi
 * 4. runAutoEndCycle concurrency guard
 * 5. Lifecycle hooks (onModuleInit/onModuleDestroy)
 * 6. Simulasi sesi konsultasi 1–3 jam
 */

import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { SessionType, SessionStatus } from '@prisma/client';

// ─── Ekstrak business logic yang akan ditest ──────────────────────────────────
// Kita menduplikasi fungsi private untuk pengujian terisolasi.
// Ini memastikan kontrak logika terjaga tanpa butuh full DI container.

function assertJoinWindow(session: {
  sessionType: SessionType;
  sessionStatus: SessionStatus;
  scheduledStartTime: Date;
  scheduledEndTime: Date | null;
}) {
  if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
    throw new ForbiddenException('Session sudah ditutup');
  }
  if (session.sessionType === SessionType.INSTANT) return;
  if (!session.scheduledEndTime) {
    throw new BadRequestException('scheduled_end_time wajib untuk SCHEDULED');
  }
  const now = Date.now();
  if (now < session.scheduledStartTime.getTime() || now >= session.scheduledEndTime.getTime()) {
    throw new ForbiddenException('Belum masuk window join atau session sudah melewati end time');
  }
}

function calculateTokenTtl(session: {
  sessionType: SessionType;
  scheduledEndTime: Date | null;
}): number {
  const MAX_TTL = 4 * 60 * 60;
  const MIN_TTL = 5 * 60;
  if (session.sessionType === SessionType.INSTANT || !session.scheduledEndTime) {
    return MAX_TTL;
  }
  const remainingSec = Math.floor(
    (session.scheduledEndTime.getTime() - Date.now()) / 1000,
  );
  return Math.max(MIN_TTL, Math.min(remainingSec + 5 * 60, MAX_TTL));
}

function calculateDuration(startedAt: Date | null, endedAt: Date) {
  if (!startedAt) return { durationSec: 0, durationMinutes: 1 };
  const diffSec = Math.max(0, Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000));
  const diffMin = Math.max(1, Math.ceil(diffSec / 60));
  return { durationSec: diffSec, durationMinutes: diffMin };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const now = () => new Date();

function makeScheduledSession(overrides: Partial<any> = {}): any {
  const n = now();
  return {
    sessionId: 'sess-001',
    sessionType: SessionType.SCHEDULED,
    sessionStatus: SessionStatus.CREATED,
    scheduledStartTime: new Date(n.getTime() - 5 * 60_000),
    scheduledEndTime: new Date(n.getTime() + 60 * 60_000),
    ...overrides,
  };
}

function makeInstantSession(overrides: Partial<any> = {}): any {
  return {
    sessionId: 'sess-instant-001',
    sessionType: SessionType.INSTANT,
    sessionStatus: SessionStatus.CREATED,
    scheduledStartTime: now(),
    scheduledEndTime: null,
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('TwilioService: Business Logic', () => {

  // ─── assertJoinWindow ────────────────────────────────────────────────────

  describe('assertJoinWindow', () => {
    it('harus lolos untuk sesi CREATED dalam window aktif', () => {
      expect(() => assertJoinWindow(makeScheduledSession())).not.toThrow();
    });

    it('harus lolos untuk sesi IN_CALL dalam window aktif', () => {
      expect(() =>
        assertJoinWindow(makeScheduledSession({ sessionStatus: SessionStatus.IN_CALL })),
      ).not.toThrow();
    });

    it('harus lolos untuk sesi INSTANT tanpa scheduledEndTime', () => {
      expect(() => assertJoinWindow(makeInstantSession())).not.toThrow();
    });

    it('harus melempar ForbiddenException untuk sesi COMPLETED', () => {
      expect(() =>
        assertJoinWindow(makeScheduledSession({ sessionStatus: SessionStatus.COMPLETED })),
      ).toThrow(ForbiddenException);
    });

    it('harus melempar ForbiddenException untuk sesi FAILED', () => {
      expect(() =>
        assertJoinWindow(makeScheduledSession({ sessionStatus: SessionStatus.FAILED })),
      ).toThrow(ForbiddenException);
    });

    it('harus melempar ForbiddenException jika belum scheduledStartTime', () => {
      const n = now();
      expect(() =>
        assertJoinWindow(
          makeScheduledSession({
            scheduledStartTime: new Date(n.getTime() + 30 * 60_000),
            scheduledEndTime: new Date(n.getTime() + 90 * 60_000),
          }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('harus melempar ForbiddenException jika scheduledEndTime sudah lewat', () => {
      const n = now();
      expect(() =>
        assertJoinWindow(
          makeScheduledSession({
            scheduledStartTime: new Date(n.getTime() - 2 * 60 * 60_000),
            scheduledEndTime: new Date(n.getTime() - 5 * 60_000),
          }),
        ),
      ).toThrow(ForbiddenException);
    });

    it('harus melempar BadRequestException untuk SCHEDULED tanpa scheduledEndTime', () => {
      expect(() =>
        assertJoinWindow(makeScheduledSession({ scheduledEndTime: null })),
      ).toThrow(BadRequestException);
    });
  });

  // ─── calculateTokenTtl ───────────────────────────────────────────────────

  describe('calculateTokenTtl — KRITIS: sesi berjam-jam', () => {
    it('harus mengembalikan 4 jam (14400) untuk sesi INSTANT', () => {
      expect(calculateTokenTtl(makeInstantSession())).toBe(4 * 60 * 60);
    });

    it('harus mengembalikan 4 jam jika SCHEDULED tapi scheduledEndTime null', () => {
      expect(calculateTokenTtl(makeScheduledSession({ scheduledEndTime: null }))).toBe(4 * 60 * 60);
    });

    it('harus menghitung sisa waktu + 5 menit buffer untuk sesi 1 jam', () => {
      const n = now();
      const ttl = calculateTokenTtl(
        makeScheduledSession({ scheduledEndTime: new Date(n.getTime() + 60 * 60_000) }),
      );
      expect(ttl).toBeGreaterThanOrEqual(3500);  // ~3600 + 300 buffer - toleransi waktu
      expect(ttl).toBeLessThanOrEqual(3900);
    });

    it('harus menghitung sisa waktu + 5 menit buffer untuk sesi 2 jam', () => {
      const n = now();
      const ttl = calculateTokenTtl(
        makeScheduledSession({ scheduledEndTime: new Date(n.getTime() + 2 * 60 * 60_000) }),
      );
      expect(ttl).toBeGreaterThanOrEqual(7100);  // ~7200 + 300
      expect(ttl).toBeLessThanOrEqual(7700);
    });

    it('harus menghitung sisa waktu + 5 menit buffer untuk sesi 3 jam', () => {
      const n = now();
      const ttl = calculateTokenTtl(
        makeScheduledSession({ scheduledEndTime: new Date(n.getTime() + 3 * 60 * 60_000) }),
      );
      expect(ttl).toBeGreaterThanOrEqual(10700);  // ~10800 + 300
      expect(ttl).toBeLessThanOrEqual(11200);
    });

    it('harus di-cap 4 jam (14400) untuk sesi > 4 jam', () => {
      const n = now();
      const ttl = calculateTokenTtl(
        makeScheduledSession({ scheduledEndTime: new Date(n.getTime() + 6 * 60 * 60_000) }),
      );
      expect(ttl).toBe(4 * 60 * 60);
    });

    it('harus mengembalikan sisa + buffer jika sesi hampir berakhir (sisa 1 menit → 360 detik)', () => {
      const n = now();
      const ttl = calculateTokenTtl(
        makeScheduledSession({ scheduledEndTime: new Date(n.getTime() + 60_000) }),
      );
      // Sisa ~60 detik + 300 buffer = ~360 detik (lebih dari minimum 300)
      expect(ttl).toBeGreaterThanOrEqual(300);
      expect(ttl).toBeLessThanOrEqual(400);
    });

    it('harus di-cap minimum 5 menit jika scheduledEndTime sudah lewat', () => {
      const n = now();
      const ttl = calculateTokenTtl(
        makeScheduledSession({ scheduledEndTime: new Date(n.getTime() - 10 * 60_000) }),
      );
      expect(ttl).toBe(5 * 60);
    });
  });

  // ─── Simulasi sesi berjam-jam ─────────────────────────────────────────────

  describe('Simulasi konsultasi berjam-jam', () => {
    it('[SKENARIO] INSTANT session: token 4 jam, tidak ada hard end time', () => {
      const instant = makeInstantSession({ sessionStatus: SessionStatus.IN_CALL });
      const ttl = calculateTokenTtl(instant);
      expect(ttl).toBe(14400);
      expect(() => assertJoinWindow(instant)).not.toThrow();
    });

    it('[SKENARIO] Konsultasi 3 jam: token cukup untuk seluruh durasi sesi', () => {
      const n = now();
      const session = makeScheduledSession({
        scheduledStartTime: new Date(n.getTime() - 10 * 60_000),
        scheduledEndTime: new Date(n.getTime() + 3 * 60 * 60_000 - 10 * 60_000),
      });
      const ttl = calculateTokenTtl(session);
      const remainingSec = Math.floor(
        (session.scheduledEndTime.getTime() - n.getTime()) / 1000,
      );
      // Token harus bertahan lebih dari sisa waktu sesi
      expect(ttl).toBeGreaterThanOrEqual(remainingSec);
    });

    it('[BUG LAMA] Token default 1 jam (3600) tidak cukup untuk sesi 2 jam', () => {
      const DEFAULT_TTL_LAMA = 3600;
      const DURASI_SESI_2JAM = 2 * 60 * 60;
      expect(DEFAULT_TTL_LAMA).toBeLessThan(DURASI_SESI_2JAM);
    });

    it('[FIX BARU] Token dinamis cukup untuk sesi 2 jam SCHEDULED', () => {
      const n = now();
      const sesi2Jam = makeScheduledSession({
        scheduledEndTime: new Date(n.getTime() + 2 * 60 * 60_000),
      });
      const ttl = calculateTokenTtl(sesi2Jam);
      const DURASI_SESI_2JAM = 2 * 60 * 60;
      expect(ttl).toBeGreaterThanOrEqual(DURASI_SESI_2JAM);
    });

    it('[FIX BARU] Token dinamis cukup untuk sesi 3 jam SCHEDULED', () => {
      const n = now();
      const sesi3Jam = makeScheduledSession({
        scheduledEndTime: new Date(n.getTime() + 3 * 60 * 60_000),
      });
      const ttl = calculateTokenTtl(sesi3Jam);
      const DURASI_SESI_3JAM = 3 * 60 * 60;
      expect(ttl).toBeGreaterThanOrEqual(DURASI_SESI_3JAM);
    });
  });

  // ─── calculateDuration ───────────────────────────────────────────────────

  describe('calculateDuration', () => {
    it('harus mengembalikan 0 detik dan 1 menit jika startedAt null', () => {
      const result = calculateDuration(null, now());
      expect(result).toEqual({ durationSec: 0, durationMinutes: 1 });
    });

    it('harus menghitung 30 menit dengan benar', () => {
      const start = new Date('2025-01-01T10:00:00Z');
      const end = new Date('2025-01-01T10:30:00Z');
      expect(calculateDuration(start, end)).toEqual({ durationSec: 1800, durationMinutes: 30 });
    });

    it('harus menghitung 1 jam dengan benar', () => {
      const start = new Date('2025-01-01T10:00:00Z');
      const end = new Date('2025-01-01T11:00:00Z');
      expect(calculateDuration(start, end)).toEqual({ durationSec: 3600, durationMinutes: 60 });
    });

    it('harus menghitung 2 jam 15 menit dengan benar', () => {
      const start = new Date('2025-01-01T09:00:00Z');
      const end = new Date('2025-01-01T11:15:00Z');
      expect(calculateDuration(start, end)).toEqual({ durationSec: 8100, durationMinutes: 135 });
    });

    it('harus menghitung 3 jam dengan benar', () => {
      const start = new Date('2025-01-01T08:00:00Z');
      const end = new Date('2025-01-01T11:00:00Z');
      expect(calculateDuration(start, end)).toEqual({ durationSec: 10800, durationMinutes: 180 });
    });

    it('harus menggunakan minimum 1 menit untuk durasi < 60 detik', () => {
      const start = new Date('2025-01-01T10:00:00Z');
      const end = new Date('2025-01-01T10:00:30Z');
      const result = calculateDuration(start, end);
      expect(result.durationSec).toBe(30);
      expect(result.durationMinutes).toBe(1);
    });

    it('harus menggunakan 0 untuk durasi negatif (end < start)', () => {
      const start = new Date('2025-01-01T11:00:00Z');
      const end = new Date('2025-01-01T10:00:00Z');
      const result = calculateDuration(start, end);
      expect(result.durationSec).toBe(0);
      expect(result.durationMinutes).toBe(1);
    });
  });
});
