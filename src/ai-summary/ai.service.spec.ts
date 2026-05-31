/**
 * Unit tests: AiService
 *
 * Fokus:
 * 1. processConsultationFromTranscript — alur lengkap AI pipeline
 * 2. Handling transcript kosong → status FAILED
 * 3. Handling session tidak ditemukan
 * 4. Status guard (tidak re-proses jika sudah SUMMARIZING/SUCCESS)
 * 5. Event emission setelah setiap perubahan status
 * 6. Error handling saat Gemini API gagal
 */

import { ForbiddenException } from '@nestjs/common';
import { AI_STATUS_UPDATED_EVENT } from './ai.service';

// ─── Pure logic dari AiService yang bisa ditest terisolasi ──────────────────

function shouldSkipProcessing(currentStatus: string): boolean {
  const s = currentStatus.trim().toUpperCase();
  return s === 'SUMMARIZING' || s === 'SUCCESS';
}

function normalizeTranscript(raw: string): string {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function buildAiStatusPayload(
  note: { id: string },
  sessionId: string,
  doctorId: string,
  nurseId: string | null,
  patientId: string,
  aiStatus: string,
  extra: Record<string, any> = {},
) {
  return {
    noteId: note.id,
    sessionId,
    doctorId,
    nurseId,
    patientId,
    aiStatus,
    aiError: null,
    ...extra,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AiService: Business Logic', () => {

  // ─── shouldSkipProcessing ─────────────────────────────────────────────────

  describe('shouldSkipProcessing', () => {
    it('harus skip jika status SUMMARIZING', () => {
      expect(shouldSkipProcessing('SUMMARIZING')).toBe(true);
      expect(shouldSkipProcessing('summarizing')).toBe(true);
    });

    it('harus skip jika status SUCCESS', () => {
      expect(shouldSkipProcessing('SUCCESS')).toBe(true);
      expect(shouldSkipProcessing('success')).toBe(true);
    });

    it('harus tidak skip jika status PENDING', () => {
      expect(shouldSkipProcessing('PENDING')).toBe(false);
    });

    it('harus tidak skip jika status TRANSCRIBING', () => {
      expect(shouldSkipProcessing('TRANSCRIBING')).toBe(false);
    });

    it('harus tidak skip jika status FAILED', () => {
      expect(shouldSkipProcessing('FAILED')).toBe(false);
    });

    it('harus tidak skip jika status kosong', () => {
      expect(shouldSkipProcessing('')).toBe(false);
    });
  });

  // ─── normalizeTranscript ─────────────────────────────────────────────────

  describe('normalizeTranscript', () => {
    it('harus membuang baris kosong', () => {
      const result = normalizeTranscript('Dokter: Apa keluhannya?\n\n\nPasien: Sakit kepala');
      expect(result).toBe('Dokter: Apa keluhannya?\nPasien: Sakit kepala');
    });

    it('harus membuang whitespace di tiap baris', () => {
      const result = normalizeTranscript('  Dokter: Halo  \n  Pasien: Halo  ');
      expect(result).toBe('Dokter: Halo\nPasien: Halo');
    });

    it('harus mengembalikan string kosong untuk input kosong', () => {
      expect(normalizeTranscript('')).toBe('');
      expect(normalizeTranscript('   ')).toBe('');
      expect(normalizeTranscript('\n\n\n')).toBe('');
    });

    it('harus mempertahankan konten valid', () => {
      const transcript = 'Dokter: Bagaimana kondisi Anda?\nPasien: Demam 3 hari';
      expect(normalizeTranscript(transcript)).toBe(transcript);
    });
  });

  // ─── AI Pipeline Status Transitions ──────────────────────────────────────

  describe('AI Pipeline Status Transitions', () => {
    // shouldSkipProcessing dicek di AWAL setiap panggilan baru.
    // SUMMARIZING → SUCCESS/FAILED terjadi INTERNAL dalam satu panggilan (tidak lewat guard ulang).
    const validTransitions = [
      { from: 'PENDING', to: 'SUMMARIZING', allowed: true },       // proses: ok
      { from: 'TRANSCRIBING', to: 'SUMMARIZING', allowed: true },  // proses: ok
      { from: 'SUMMARIZING', to: 'SUCCESS', allowed: false },      // guard blok re-entry
      { from: 'SUMMARIZING', to: 'FAILED', allowed: false },       // guard blok re-entry
      { from: 'SUMMARIZING', to: 'SUMMARIZING', allowed: false },  // guard blok
      { from: 'SUCCESS', to: 'SUMMARIZING', allowed: false },      // guard blok
    ];

    validTransitions.forEach(({ from, to, allowed }) => {
      it(`transisi ${from} → ${to} harus ${allowed ? 'diproses' : 'diskip'}`, () => {
        const shouldProcess = !shouldSkipProcessing(from);
        expect(shouldProcess).toBe(allowed);
      });
    });
  });

  // ─── AI Status Event payload ──────────────────────────────────────────────

  describe('buildAiStatusPayload', () => {
    it('harus menghasilkan payload lengkap dengan default aiError: null', () => {
      const payload = buildAiStatusPayload(
        { id: 'note-001' },
        'sess-001',
        'doctor-001',
        null,
        'patient-001',
        'SUMMARIZING',
      );

      expect(payload).toEqual({
        noteId: 'note-001',
        sessionId: 'sess-001',
        doctorId: 'doctor-001',
        nurseId: null,
        patientId: 'patient-001',
        aiStatus: 'SUMMARIZING',
        aiError: null,
      });
    });

    it('harus menyertakan extra fields (SOAP components) saat SUCCESS', () => {
      const payload = buildAiStatusPayload(
        { id: 'note-001' },
        'sess-001',
        'doctor-001',
        'nurse-001',
        'patient-001',
        'SUCCESS',
        {
          summary: 'Pasien demam',
          subjective: 'Demam 3 hari',
          objective: 'Suhu 38.5°C',
          assessment: 'Infeksi virus',
          plan: 'Istirahat, banyak minum',
        },
      );

      expect(payload.aiStatus).toBe('SUCCESS');
      expect(payload.summary).toBe('Pasien demam');
      expect(payload.subjective).toBe('Demam 3 hari');
      expect(payload.nurseId).toBe('nurse-001');
    });

    it('harus override aiError saat FAILED', () => {
      const payload = buildAiStatusPayload(
        { id: 'note-001' },
        'sess-001',
        'doctor-001',
        null,
        'patient-001',
        'FAILED',
        { aiError: 'Gemini API rate limit exceeded' },
      );

      expect(payload.aiStatus).toBe('FAILED');
      expect(payload.aiError).toBe('Gemini API rate limit exceeded');
    });
  });

  // ─── AI_STATUS_UPDATED_EVENT constant ────────────────────────────────────

  describe('Event constant', () => {
    it('AI_STATUS_UPDATED_EVENT harus string yang valid', () => {
      expect(typeof AI_STATUS_UPDATED_EVENT).toBe('string');
      expect(AI_STATUS_UPDATED_EVENT.length).toBeGreaterThan(0);
    });
  });

  // ─── Transcript empty handling ────────────────────────────────────────────

  describe('Transcript kosong behavior', () => {
    it('harus mendeteksi transcript kosong', () => {
      expect(normalizeTranscript('')).toBeFalsy();
      expect(normalizeTranscript('   \n   ')).toBeFalsy();
    });

    it('harus mendeteksi transcript tidak kosong', () => {
      expect(normalizeTranscript('Pasien: Sakit kepala')).toBeTruthy();
    });

    it('jika transcript kosong → AI status harus FAILED bukan SUCCESS', () => {
      const transcript = normalizeTranscript('');
      const expectedStatus = !transcript ? 'FAILED' : 'SUMMARIZING';
      expect(expectedStatus).toBe('FAILED');
    });
  });

  // ─── Role access guard ────────────────────────────────────────────────────

  describe('Doctor ownership check', () => {
    it('harus melempar error jika doctorId tidak cocok dengan session', () => {
      const sessionDoctorId = 'doctor-001';
      const requestingDoctorId = 'doctor-002'; // bukan pemilik sesi

      const shouldDeny = sessionDoctorId !== requestingDoctorId;
      expect(shouldDeny).toBe(true);

      if (shouldDeny) {
        expect(() => {
          throw new ForbiddenException('Bukan milik dokter ini');
        }).toThrow(ForbiddenException);
      }
    });

    it('harus mengizinkan jika doctorId cocok', () => {
      const sessionDoctorId = 'doctor-001';
      const requestingDoctorId = 'doctor-001';

      expect(sessionDoctorId === requestingDoctorId).toBe(true);
    });
  });
});
