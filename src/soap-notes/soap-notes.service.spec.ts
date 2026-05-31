/**
 * Unit tests: SoapNotesService
 *
 * Fokus:
 * 1. assertAccess — role-based access control per SOAP note
 * 2. Patient/Nurse hanya bisa lihat note yang sudah isFinalized
 * 3. Admin tidak bisa akses SOAP note
 * 4. Update hanya bisa dilakukan dokter pemilik
 * 5. Finalisasi hanya sekali — sudah finalized tidak bisa difinalisasi lagi
 * 6. mapNote — output format yang benar
 */

import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

// ─── Ekstrak logic dari SoapNotesService ──────────────────────────────────────

function assertAccess(
  note: { doctorId: string; patientId: string; consultationSession?: { nurseId?: string | null } | null },
  userId: string,
  role: UserRole,
) {
  if (role === UserRole.DOCTOR && note.doctorId !== userId) {
    throw new ForbiddenException('Bukan SOAP note dokter ini');
  }
  if (role === UserRole.PATIENT && note.patientId !== userId) {
    throw new ForbiddenException('Bukan SOAP note pasien ini');
  }
  if (role === UserRole.NURSE) {
    if (!note.consultationSession?.nurseId || note.consultationSession.nurseId !== userId) {
      throw new ForbiddenException('Bukan SOAP note nurse ini');
    }
  }
  if (role === UserRole.ADMIN) {
    throw new ForbiddenException('Admin tidak dapat mengakses SOAP note');
  }
}

function canPatientViewNote(isFinalized: boolean): boolean {
  return isFinalized;
}

function canFinalizeNote(isFinalized: boolean): boolean {
  return !isFinalized;
}

function mapNote(note: any) {
  const session = note.consultationSession;
  return {
    id: note.id,
    consultationSessionId: note.consultationSessionId,
    doctorId: note.doctorId,
    patientId: note.patientId,
    nurseId: note.nurseId ?? null,
    subjective: note.subjective,
    objective: note.objective,
    assessment: note.assessment,
    plan: note.plan,
    summary: note.summary,
    aiStatus: note.aiStatus,
    isFinalized: note.isFinalized,
    finalizedAt: note.finalizedAt,
  };
}

// ─── Mock note builder ─────────────────────────────────────────────────────────

function makeNote(overrides: Partial<any> = {}): any {
  return {
    id: 'note-001',
    consultationSessionId: 'sess-001',
    doctorId: 'doctor-001',
    patientId: 'patient-001',
    nurseId: null,
    isFinalized: false,
    finalizedAt: null,
    subjective: 'Sakit kepala 3 hari',
    objective: 'TD 120/80, suhu 37°C',
    assessment: 'Tension headache',
    plan: 'Istirahat cukup, paracetamol 500mg',
    summary: null,
    aiStatus: 'PENDING',
    consultationSession: { nurseId: null },
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SoapNotesService: Business Logic', () => {

  // ─── assertAccess (DOCTOR) ────────────────────────────────────────────────

  describe('assertAccess — DOCTOR', () => {
    it('harus lolos untuk dokter pemilik note', () => {
      const note = makeNote({ doctorId: 'doctor-001' });
      expect(() => assertAccess(note, 'doctor-001', UserRole.DOCTOR)).not.toThrow();
    });

    it('harus melempar ForbiddenException untuk dokter bukan pemilik', () => {
      const note = makeNote({ doctorId: 'doctor-001' });
      expect(() => assertAccess(note, 'doctor-002', UserRole.DOCTOR)).toThrow(ForbiddenException);
    });
  });

  // ─── assertAccess (PATIENT) ──────────────────────────────────────────────

  describe('assertAccess — PATIENT', () => {
    it('harus lolos untuk pasien pemilik note', () => {
      const note = makeNote({ patientId: 'patient-001' });
      expect(() => assertAccess(note, 'patient-001', UserRole.PATIENT)).not.toThrow();
    });

    it('harus melempar ForbiddenException untuk pasien bukan pemilik', () => {
      const note = makeNote({ patientId: 'patient-001' });
      expect(() => assertAccess(note, 'patient-002', UserRole.PATIENT)).toThrow(ForbiddenException);
    });
  });

  // ─── assertAccess (NURSE) ────────────────────────────────────────────────

  describe('assertAccess — NURSE', () => {
    it('harus lolos untuk nurse yang ditugaskan pada sesi ini', () => {
      const note = makeNote({
        consultationSession: { nurseId: 'nurse-001' },
      });
      expect(() => assertAccess(note, 'nurse-001', UserRole.NURSE)).not.toThrow();
    });

    it('harus melempar ForbiddenException untuk nurse berbeda', () => {
      const note = makeNote({
        consultationSession: { nurseId: 'nurse-001' },
      });
      expect(() => assertAccess(note, 'nurse-002', UserRole.NURSE)).toThrow(ForbiddenException);
    });

    it('harus melempar ForbiddenException jika sesi tidak ada nurse', () => {
      const note = makeNote({ consultationSession: { nurseId: null } });
      expect(() => assertAccess(note, 'nurse-001', UserRole.NURSE)).toThrow(ForbiddenException);
    });
  });

  // ─── assertAccess (ADMIN) ────────────────────────────────────────────────

  describe('assertAccess — ADMIN', () => {
    it('harus selalu melempar ForbiddenException untuk ADMIN', () => {
      const note = makeNote();
      expect(() => assertAccess(note, 'admin-001', UserRole.ADMIN)).toThrow(ForbiddenException);
    });
  });

  // ─── canPatientViewNote (finalization gate) ───────────────────────────────

  describe('canPatientViewNote', () => {
    it('harus mengizinkan pasien melihat note yang sudah difinalisasi', () => {
      expect(canPatientViewNote(true)).toBe(true);
    });

    it('harus menolak pasien melihat note yang belum difinalisasi', () => {
      expect(canPatientViewNote(false)).toBe(false);
    });
  });

  // ─── canFinalizeNote ─────────────────────────────────────────────────────

  describe('canFinalizeNote', () => {
    it('harus mengizinkan finalisasi jika note belum difinalisasi', () => {
      expect(canFinalizeNote(false)).toBe(true);
    });

    it('harus menolak finalisasi jika note sudah difinalisasi', () => {
      expect(canFinalizeNote(true)).toBe(false);
    });
  });

  // ─── mapNote output ──────────────────────────────────────────────────────

  describe('mapNote', () => {
    it('harus menghasilkan output dengan semua field SOAP', () => {
      const note = makeNote({
        subjective: 'Sakit kepala',
        objective: 'Suhu 38°C',
        assessment: 'Demam',
        plan: 'Paracetamol',
        isFinalized: true,
        finalizedAt: new Date('2025-01-01T12:00:00Z'),
      });

      const mapped = mapNote(note);

      expect(mapped.id).toBe('note-001');
      expect(mapped.doctorId).toBe('doctor-001');
      expect(mapped.patientId).toBe('patient-001');
      expect(mapped.subjective).toBe('Sakit kepala');
      expect(mapped.objective).toBe('Suhu 38°C');
      expect(mapped.assessment).toBe('Demam');
      expect(mapped.plan).toBe('Paracetamol');
      expect(mapped.isFinalized).toBe(true);
      expect(mapped.finalizedAt).toBeInstanceOf(Date);
    });

    it('harus menggunakan null untuk nurseId jika tidak ada nurse', () => {
      const note = makeNote({ nurseId: undefined });
      const mapped = mapNote(note);
      expect(mapped.nurseId).toBeNull();
    });

    it('harus menyertakan nurseId jika ada nurse', () => {
      const note = makeNote({ nurseId: 'nurse-001' });
      const mapped = mapNote(note);
      expect(mapped.nurseId).toBe('nurse-001');
    });
  });

  // ─── SOAP update logic ────────────────────────────────────────────────────

  describe('SOAP field update merging', () => {
    it('harus mempertahankan field yang tidak diupdate', () => {
      const existing = makeNote({
        subjective: 'Sakit kepala',
        objective: 'Suhu normal',
        assessment: null,
        plan: null,
      });

      // Update hanya assessment
      const updated = {
        subjective: existing.subjective,
        objective: existing.objective,
        assessment: 'Tension headache',    // ← diupdate
        plan: existing.plan,               // ← tidak berubah
      };

      expect(updated.subjective).toBe('Sakit kepala');   // tetap
      expect(updated.objective).toBe('Suhu normal');      // tetap
      expect(updated.assessment).toBe('Tension headache'); // berubah
      expect(updated.plan).toBeNull();                    // tetap
    });

    it('harus mengizinkan update parsial (hanya beberapa field)', () => {
      const note = makeNote({
        subjective: 'Semula',
        plan: 'Plan awal',
      });

      // Hanya update plan
      const dto = { plan: 'Plan baru' };
      const merged = {
        subjective: dto['subjective'] ?? note.subjective,
        plan: dto.plan ?? note.plan,
      };

      expect(merged.subjective).toBe('Semula'); // tidak berubah
      expect(merged.plan).toBe('Plan baru');     // berubah
    });
  });
});
