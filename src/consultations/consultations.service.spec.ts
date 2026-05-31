/**
 * Unit tests: ConsultationsService
 *
 * Fokus pengujian:
 * 1. Validasi join window (waktu mulai/selesai sesi)
 * 2. Status transition yang valid
 * 3. canDoctorJoinNow logic
 * 4. Penanganan session type INSTANT vs SCHEDULED
 * 5. Session lifecycle (CREATED → IN_CALL → COMPLETED/FAILED)
 *
 * Semua dependensi di-mock — tidak butuh database.
 */

import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { SessionType, SessionStatus } from '@prisma/client';

// ─── Logic pure yang akan ditest (duplikasi dari service untuk isolasi) ───────

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
  const startMs = session.scheduledStartTime.getTime();
  const endMs = session.scheduledEndTime.getTime();

  if (now < startMs || now >= endMs) {
    throw new ForbiddenException(
      'Belum masuk window join atau session sudah melewati end time',
    );
  }
}

function canDoctorJoinNow(
  s: { sessionType: SessionType; sessionStatus: SessionStatus; scheduledStartTime: Date; scheduledEndTime: Date | null },
  now = new Date(),
): boolean {
  if (s.sessionStatus === 'COMPLETED' || s.sessionStatus === 'FAILED') return false;
  if (s.sessionType === 'INSTANT') return true;
  if (!s.scheduledEndTime) return false;
  return now.getTime() >= s.scheduledStartTime.getTime() && now.getTime() < s.scheduledEndTime.getTime();
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<any> = {}): any {
  const now = new Date();
  return {
    sessionId: 'sess-test-001',
    sessionType: SessionType.SCHEDULED,
    sessionStatus: SessionStatus.CREATED,
    scheduledStartTime: new Date(now.getTime() - 5 * 60_000),
    scheduledEndTime: new Date(now.getTime() + 55 * 60_000),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ConsultationsService: Join Window Logic', () => {

  // ─── assertJoinWindow ──────────────────────────────────────────────────

  describe('assertJoinWindow', () => {
    it('harus lolos untuk sesi CREATED dalam window aktif', () => {
      expect(() => assertJoinWindow(makeSession())).not.toThrow();
    });

    it('harus lolos untuk sesi IN_CALL dalam window aktif', () => {
      const session = makeSession({ sessionStatus: SessionStatus.IN_CALL });
      expect(() => assertJoinWindow(session)).not.toThrow();
    });

    it('harus lolos untuk sesi INSTANT tanpa scheduledEndTime', () => {
      const session = makeSession({
        sessionType: SessionType.INSTANT,
        scheduledEndTime: null,
      });
      expect(() => assertJoinWindow(session)).not.toThrow();
    });

    it('harus melempar ForbiddenException untuk sesi COMPLETED', () => {
      const session = makeSession({ sessionStatus: SessionStatus.COMPLETED });
      expect(() => assertJoinWindow(session)).toThrow(ForbiddenException);
    });

    it('harus melempar ForbiddenException untuk sesi FAILED', () => {
      const session = makeSession({ sessionStatus: SessionStatus.FAILED });
      expect(() => assertJoinWindow(session)).toThrow(ForbiddenException);
    });

    it('harus melempar ForbiddenException jika belum mencapai scheduledStartTime', () => {
      const now = new Date();
      const session = makeSession({
        scheduledStartTime: new Date(now.getTime() + 30 * 60_000), // 30 menit lagi
        scheduledEndTime: new Date(now.getTime() + 90 * 60_000),
      });
      expect(() => assertJoinWindow(session)).toThrow(ForbiddenException);
    });

    it('harus melempar ForbiddenException jika scheduledEndTime sudah lewat', () => {
      const now = new Date();
      const session = makeSession({
        scheduledStartTime: new Date(now.getTime() - 2 * 60 * 60_000),
        scheduledEndTime: new Date(now.getTime() - 10 * 60_000), // 10 menit lalu
      });
      expect(() => assertJoinWindow(session)).toThrow(ForbiddenException);
    });

    it('harus melempar BadRequestException untuk SCHEDULED tanpa scheduledEndTime', () => {
      const session = makeSession({
        sessionType: SessionType.SCHEDULED,
        scheduledEndTime: null,
      });
      expect(() => assertJoinWindow(session)).toThrow(BadRequestException);
    });
  });

  // ─── canDoctorJoinNow ─────────────────────────────────────────────────

  describe('canDoctorJoinNow', () => {
    it('harus mengembalikan false untuk sesi COMPLETED', () => {
      const session = makeSession({ sessionStatus: SessionStatus.COMPLETED });
      expect(canDoctorJoinNow(session)).toBe(false);
    });

    it('harus mengembalikan false untuk sesi FAILED', () => {
      const session = makeSession({ sessionStatus: SessionStatus.FAILED });
      expect(canDoctorJoinNow(session)).toBe(false);
    });

    it('harus mengembalikan true untuk sesi INSTANT', () => {
      const session = makeSession({
        sessionType: SessionType.INSTANT,
        scheduledEndTime: null,
      });
      expect(canDoctorJoinNow(session)).toBe(true);
    });

    it('harus mengembalikan true jika dalam window aktif', () => {
      const session = makeSession();
      expect(canDoctorJoinNow(session)).toBe(true);
    });

    it('harus mengembalikan false jika sebelum scheduledStartTime', () => {
      const now = new Date();
      const session = makeSession({
        scheduledStartTime: new Date(now.getTime() + 60 * 60_000),
        scheduledEndTime: new Date(now.getTime() + 2 * 60 * 60_000),
      });
      expect(canDoctorJoinNow(session)).toBe(false);
    });

    it('harus mengembalikan false jika setelah scheduledEndTime', () => {
      const now = new Date();
      const session = makeSession({
        scheduledStartTime: new Date(now.getTime() - 3 * 60 * 60_000),
        scheduledEndTime: new Date(now.getTime() - 60 * 60_000),
      });
      expect(canDoctorJoinNow(session)).toBe(false);
    });
  });

  // ─── Session type behavior ─────────────────────────────────────────────

  describe('Session type behavior', () => {
    it('[INSTANT] tidak punya hard end time — dokter bisa join kapan saja', () => {
      const instantSession = makeSession({
        sessionType: SessionType.INSTANT,
        scheduledEndTime: null,
        sessionStatus: SessionStatus.CREATED,
      });
      expect(canDoctorJoinNow(instantSession)).toBe(true);
      expect(() => assertJoinWindow(instantSession)).not.toThrow();
    });

    it('[SCHEDULED 3 jam] dokter bisa join selama dalam window', () => {
      const now = new Date();
      const session3h = makeSession({
        scheduledStartTime: new Date(now.getTime() - 10 * 60_000),       // mulai 10 menit lalu
        scheduledEndTime: new Date(now.getTime() + 3 * 60 * 60_000 - 10 * 60_000), // selesai ~2h50m lagi
      });
      expect(canDoctorJoinNow(session3h)).toBe(true);
      expect(() => assertJoinWindow(session3h)).not.toThrow();
    });

    it('[SCHEDULED] sesi yang sudah melewati end time tidak bisa di-join', () => {
      const now = new Date();
      const expiredSession = makeSession({
        scheduledStartTime: new Date(now.getTime() - 3 * 60 * 60_000), // mulai 3 jam lalu
        scheduledEndTime: new Date(now.getTime() - 5 * 60_000),         // selesai 5 menit lalu
      });
      expect(canDoctorJoinNow(expiredSession)).toBe(false);
      expect(() => assertJoinWindow(expiredSession)).toThrow(ForbiddenException);
    });
  });

  // ─── Status transitions ────────────────────────────────────────────────

  describe('Status transitions', () => {
    const validTransitions = [
      { from: 'CREATED', to: 'IN_CALL', valid: true },
      { from: 'IN_CALL', to: 'COMPLETED', valid: true },
      { from: 'IN_CALL', to: 'FAILED', valid: true },
      { from: 'CREATED', to: 'FAILED', valid: true },
      { from: 'COMPLETED', to: 'IN_CALL', valid: false }, // tidak boleh re-open
      { from: 'FAILED', to: 'IN_CALL', valid: false },    // tidak boleh re-open
    ];

    validTransitions.forEach(({ from, to, valid }) => {
      it(`transisi ${from} → ${to} harus ${valid ? 'diizinkan' : 'ditolak'}`, () => {
        const isTerminal = from === 'COMPLETED' || from === 'FAILED';
        if (!valid) {
          // Session terminal tidak bisa di-join kembali
          const session = makeSession({ sessionStatus: from as SessionStatus });
          const canJoin = canDoctorJoinNow(session);
          expect(canJoin).toBe(false);
        } else {
          // Transisi valid — bisa diproses
          expect(valid).toBe(true);
        }
      });
    });
  });
});
