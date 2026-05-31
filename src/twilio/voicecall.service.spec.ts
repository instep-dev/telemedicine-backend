/**
 * Unit tests: VoiceCallService
 *
 * VoiceCallService adalah thin wrapper di atas VideoCallService.
 * Tests memverifikasi bahwa delegasi berjalan benar.
 */

import { VoiceCallService } from './voicecall.service';
import { VideoCallService } from './videocall.service';

// ─── Mock VideoCallService ────────────────────────────────────────────────────

const mockVideoCallService = {
  generateToken: jest.fn().mockReturnValue('mock.voice.token'),
  ensureRoom: jest.fn().mockResolvedValue({ sid: 'RM_voice_001', status: 'in-progress' }),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('VoiceCallService', () => {
  let service: VoiceCallService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VoiceCallService(mockVideoCallService as unknown as VideoCallService);
  });

  // ─── generateToken ──────────────────────────────────────────────────────

  describe('generateToken', () => {
    it('harus mendelegasikan ke VideoCallService.generateToken', () => {
      const token = service.generateToken('nurse_001', 'room_abc');
      expect(mockVideoCallService.generateToken).toHaveBeenCalledWith('nurse_001', 'room_abc', 3600);
      expect(token).toBe('mock.voice.token');
    });

    it('harus mengoper TTL custom ke VideoCallService', () => {
      service.generateToken('doctor_001', 'room_xyz', 7200);
      expect(mockVideoCallService.generateToken).toHaveBeenCalledWith('doctor_001', 'room_xyz', 7200);
    });

    it('harus menggunakan TTL default 3600 jika tidak dioper', () => {
      service.generateToken('patient_001', 'room_test');
      expect(mockVideoCallService.generateToken).toHaveBeenCalledWith(
        'patient_001',
        'room_test',
        3600,
      );
    });

    it('harus mengembalikan token dari VideoCallService', () => {
      mockVideoCallService.generateToken.mockReturnValueOnce('specific.voice.token');
      const token = service.generateToken('identity', 'room');
      expect(token).toBe('specific.voice.token');
    });
  });

  // ─── ensureRoom ─────────────────────────────────────────────────────────

  describe('ensureRoom', () => {
    it('harus mendelegasikan ke VideoCallService.ensureRoom', async () => {
      const room = await service.ensureRoom('room_voice', 'https://cb.test');
      expect(mockVideoCallService.ensureRoom).toHaveBeenCalledWith('room_voice', 'https://cb.test');
      expect(room).toEqual({ sid: 'RM_voice_001', status: 'in-progress' });
    });

    it('harus mengembalikan room dari VideoCallService', async () => {
      mockVideoCallService.ensureRoom.mockResolvedValueOnce({ sid: 'RM_new', status: 'in-progress' });
      const room = await service.ensureRoom('room_new', 'https://cb2.test');
      expect(room.sid).toBe('RM_new');
    });
  });

  // ─── Behavior konsistensi dengan video ────────────────────────────────────

  describe('Voice sama dengan Video (audio-first)', () => {
    it('harus menggunakan Twilio Video room (bukan Twilio Voice TwiML)', () => {
      // VoiceCallService menggunakan VideoCallService → Twilio Video room
      // bukan Twilio Voice (TwiML). Ini by design: voice consultation
      // adalah video room dengan audio-only mode di frontend.
      service.generateToken('doctor', 'room');
      expect(mockVideoCallService.generateToken).toHaveBeenCalled();
    });
  });
});
