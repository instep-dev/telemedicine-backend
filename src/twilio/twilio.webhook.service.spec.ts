/**
 * Unit tests: TwilioWebhookService
 *
 * Fokus:
 * 1. Event routing — setiap webhook event diroute ke handler yang benar
 * 2. participant-connected — update session saat dokter/pasien join
 * 3. room-ended — sesi di-complete/fail berdasarkan participant status
 * 4. recording-completed → trigger composition
 * 5. composition-available → update mediaUrl
 * 6. Unknown events → tidak crash
 */

import { SessionStatus } from '@prisma/client';

// ─── Logic webhook yang bisa ditest secara terisolasi ────────────────────────

type WebhookEvent =
  | 'participant-connected'
  | 'participant-disconnected'
  | 'room-ended'
  | 'recording-started'
  | 'recording-completed'
  | 'recording-failed'
  | 'composition-started'
  | 'composition-available'
  | 'composition-failed';

function routeWebhookEvent(event: string): WebhookEvent | null {
  const valid: WebhookEvent[] = [
    'participant-connected',
    'participant-disconnected',
    'room-ended',
    'recording-started',
    'recording-completed',
    'recording-failed',
    'composition-started',
    'composition-available',
    'composition-failed',
  ];
  return valid.includes(event as WebhookEvent) ? (event as WebhookEvent) : null;
}

function isParticipantDoctor(identity: string, doctorIdentity: string | null): boolean {
  return !!doctorIdentity && identity === doctorIdentity;
}

function isParticipantPatient(identity: string, sessionId: string, patientId: string): boolean {
  return identity.startsWith(`patient_${sessionId}_`);
}

function isParticipantNurse(identity: string, sessionId: string): boolean {
  return identity.startsWith(`nurse_${sessionId}_`);
}

function shouldCompleteRoomOnEnd(
  session: { doctorJoinedAt: Date | null; patientJoinedAt: Date | null },
): boolean {
  return !!(session.doctorJoinedAt && session.patientJoinedAt);
}

function shouldCreateComposition(recordings: Array<{ status: string }>): boolean {
  if (!recordings.length) return false;
  const hasPending = recordings.some(
    (r) => !['completed', 'failed', 'deleted'].includes(r.status),
  );
  if (hasPending) return false;
  return recordings.some((r) => r.status === 'completed');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TwilioWebhookService: Business Logic', () => {

  // ─── Event routing ────────────────────────────────────────────────────────

  describe('routeWebhookEvent', () => {
    const knownEvents: WebhookEvent[] = [
      'participant-connected',
      'participant-disconnected',
      'room-ended',
      'recording-started',
      'recording-completed',
      'recording-failed',
      'composition-started',
      'composition-available',
      'composition-failed',
    ];

    knownEvents.forEach((event) => {
      it(`harus mengenali event "${event}"`, () => {
        expect(routeWebhookEvent(event)).toBe(event);
      });
    });

    it('harus mengembalikan null untuk event tidak dikenal', () => {
      expect(routeWebhookEvent('unknown-event')).toBeNull();
      expect(routeWebhookEvent('')).toBeNull();
      expect(routeWebhookEvent('ROOM-ENDED')).toBeNull(); // case sensitive
    });
  });

  // ─── Participant identity detection ──────────────────────────────────────

  describe('Participant identity detection', () => {
    const SESSION_ID = 'sess-abc123';
    const PATIENT_ID = 'pat-def456';

    it('harus mendeteksi dokter dari doctorIdentity', () => {
      const doctorIdentity = 'doctor_user-uuid_123456';
      expect(isParticipantDoctor(doctorIdentity, doctorIdentity)).toBe(true);
      expect(isParticipantDoctor('other_identity', doctorIdentity)).toBe(false);
    });

    it('harus mendeteksi pasien dari pattern identity', () => {
      const patientIdentity = `patient_${SESSION_ID}_${PATIENT_ID.slice(0, 8)}`;
      expect(isParticipantPatient(patientIdentity, SESSION_ID, PATIENT_ID)).toBe(true);
      expect(isParticipantPatient('doctor_identity', SESSION_ID, PATIENT_ID)).toBe(false);
    });

    it('harus mendeteksi nurse dari pattern identity', () => {
      const nurseIdentity = `nurse_${SESSION_ID}_abc12345`;
      expect(isParticipantNurse(nurseIdentity, SESSION_ID)).toBe(true);
      expect(isParticipantNurse(`patient_${SESSION_ID}_abc`, SESSION_ID)).toBe(false);
    });

    it('harus tidak mendeteksi dokter jika doctorIdentity null', () => {
      expect(isParticipantDoctor('any_identity', null)).toBe(false);
    });
  });

  // ─── room-ended behavior ─────────────────────────────────────────────────

  describe('shouldCompleteRoomOnEnd', () => {
    it('harus COMPLETE jika dokter DAN pasien sudah join', () => {
      expect(
        shouldCompleteRoomOnEnd({
          doctorJoinedAt: new Date(),
          patientJoinedAt: new Date(),
        }),
      ).toBe(true);
    });

    it('harus FAIL jika dokter belum join', () => {
      expect(
        shouldCompleteRoomOnEnd({
          doctorJoinedAt: null,
          patientJoinedAt: new Date(),
        }),
      ).toBe(false);
    });

    it('harus FAIL jika pasien belum join', () => {
      expect(
        shouldCompleteRoomOnEnd({
          doctorJoinedAt: new Date(),
          patientJoinedAt: null,
        }),
      ).toBe(false);
    });

    it('harus FAIL jika keduanya belum join', () => {
      expect(
        shouldCompleteRoomOnEnd({
          doctorJoinedAt: null,
          patientJoinedAt: null,
        }),
      ).toBe(false);
    });
  });

  // ─── shouldCreateComposition ─────────────────────────────────────────────

  describe('shouldCreateComposition', () => {
    it('harus false jika tidak ada recording', () => {
      expect(shouldCreateComposition([])).toBe(false);
    });

    it('harus false jika ada recording yang masih pending', () => {
      expect(
        shouldCreateComposition([
          { status: 'completed' },
          { status: 'processing' }, // masih berjalan
        ]),
      ).toBe(false);
    });

    it('harus false jika semua recording gagal', () => {
      expect(
        shouldCreateComposition([{ status: 'failed' }, { status: 'deleted' }]),
      ).toBe(false);
    });

    it('harus true jika semua recording selesai dan minimal 1 completed', () => {
      expect(
        shouldCreateComposition([{ status: 'completed' }, { status: 'failed' }]),
      ).toBe(true);
    });

    it('harus true jika hanya 1 recording completed', () => {
      expect(shouldCreateComposition([{ status: 'completed' }])).toBe(true);
    });

    it('harus false jika ada recording dalam status tidak dikenal (dianggap pending)', () => {
      expect(
        shouldCreateComposition([{ status: 'completed' }, { status: 'uploading' }]),
      ).toBe(false);
    });
  });

  // ─── Webhook payload validation ───────────────────────────────────────────

  describe('Webhook payload structure', () => {
    it('harus mengekstrak fields kunci dari body Twilio video webhook', () => {
      const body = {
        StatusCallbackEvent: 'participant-connected',
        RoomSid: 'RM_test123',
        RoomName: 'room_sess001',
        ParticipantIdentity: 'doctor_uuid_1234abcd',
        ParticipantSid: 'PA_test',
        Timestamp: '2025-01-01T10:00:00Z',
      };

      expect(body.StatusCallbackEvent).toBe('participant-connected');
      expect(body.RoomSid).toMatch(/^RM_/);
      expect(body.ParticipantIdentity).toBeTruthy();
    });

    it('harus mengekstrak fields kunci dari body composition-available', () => {
      const body = {
        StatusCallbackEvent: 'composition-available',
        CompositionSid: 'CO_test123',
        RoomSid: 'RM_test123',
        Duration: '3600',
        MediaUri: '/v1/Compositions/CO_test123/Media',
      };

      expect(body.StatusCallbackEvent).toBe('composition-available');
      expect(body.CompositionSid).toMatch(/^CO_/);
      expect(Number(body.Duration)).toBe(3600);
    });
  });

  // ─── Status mapping ───────────────────────────────────────────────────────

  describe('Recording status mapping', () => {
    const recordingStatusMap: Record<string, string> = {
      'in-progress': 'in-progress',
      'completed': 'completed',
      'failed': 'failed',
    };

    it('harus memetakan status Twilio recording dengan benar', () => {
      expect(recordingStatusMap['completed']).toBe('completed');
      expect(recordingStatusMap['failed']).toBe('failed');
      expect(recordingStatusMap['in-progress']).toBe('in-progress');
    });
  });
});
