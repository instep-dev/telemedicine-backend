/**
 * Unit tests: VideoCallService
 * Fokus: generateToken TTL, ensureRoom, completeRoom
 * Semua Twilio SDK calls di-mock — tidak butuh credential asli.
 */

// ─── Mock twilio SEBELUM import ────────────────────────────────────────────────
// Catatan: jest.mock di-hoist ke atas oleh Jest, jadi variabel di luar scope
// tidak bisa diakses di dalam factory. Gunakan module-level mock yang diakses
// via jest.mocked() atau retrieve setelah import.

let mockToJwt: jest.Mock;
let mockAddGrant: jest.Mock;
let mockVideoGrantConstructor: jest.Mock;
let mockAccessTokenConstructor: jest.Mock;
let mockRoomFetch: jest.Mock;
let mockRoomCreate: jest.Mock;
let mockRoomUpdate: jest.Mock;
let mockRecordingsList: jest.Mock;
let mockCompositionsCreate: jest.Mock;

jest.mock('twilio', () => {
  // Buat fresh mocks di dalam factory (tidak bisa akses outer scope karena hoisting)
  const toJwt = jest.fn().mockReturnValue('mock.jwt.token');
  const addGrant = jest.fn();
  const VideoGrant = jest.fn();
  const AccessToken = Object.assign(
    jest.fn().mockImplementation(() => ({ addGrant, toJwt })),
    { VideoGrant },
  );

  const roomUpdate = jest.fn().mockResolvedValue({ status: 'completed' });
  const recordingsList = jest.fn().mockResolvedValue([]);
  const roomFetch = jest.fn();
  const compositionsCreate = jest.fn().mockResolvedValue({ sid: 'CO_mock', status: 'enqueued' });

  const client = {
    video: {
      v1: {
        rooms: jest.fn().mockReturnValue({
          fetch: roomFetch,
          update: roomUpdate,
          recordings: { list: recordingsList },
        }),
        compositions: { create: compositionsCreate },
      },
    },
    request: jest.fn(),
  };

  const mockTwilioFn = jest.fn().mockReturnValue(client);
  (mockTwilioFn as any).jwt = { AccessToken };
  // __esModule: true diperlukan agar default import bekerja dengan ts-jest
  return { __esModule: true, default: mockTwilioFn };
});

// Setelah mock, baru import
import { VideoCallService } from './videocall.service';
import twilio from 'twilio';

// ─── Setup ────────────────────────────────────────────────────────────────────

describe('VideoCallService', () => {
  let service: VideoCallService;
  let twilioClient: any;
  let AccessToken: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TWILIO_ACCOUNT_SID = 'ACtest123';
    process.env.TWILIO_API_KEY_SID = 'SKtest123';
    process.env.TWILIO_API_KEY_SECRET = 'secrettest123';
    service = new VideoCallService();

    // Akses mock client dan AccessToken
    twilioClient = (twilio as any).mock.results[0]?.value ?? (service as any).client;
    AccessToken = (twilio as any).jwt.AccessToken;
  });

  // ─── generateToken ──────────────────────────────────────────────────────────

  describe('generateToken', () => {
    it('harus mengembalikan string JWT', () => {
      const token = service.generateToken('doctor_abc', 'room_xyz');
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('harus membuat AccessToken dengan identity yang benar', () => {
      service.generateToken('nurse_001', 'room_test');
      expect(AccessToken).toHaveBeenCalledWith(
        'ACtest123',
        'SKtest123',
        'secrettest123',
        expect.objectContaining({ identity: 'nurse_001' }),
      );
    });

    it('harus menggunakan TTL default 3600 detik (1 jam)', () => {
      service.generateToken('identity', 'room');
      expect(AccessToken).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ ttl: 3600 }),
      );
    });

    it('harus menggunakan TTL custom 10800 (3 jam) jika dioper', () => {
      service.generateToken('identity', 'room', 10800);
      expect(AccessToken).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ ttl: 10800 }),
      );
    });

    it('harus menggunakan TTL custom 14400 (4 jam) untuk long session', () => {
      service.generateToken('doctor_long', 'room_long', 14400);
      expect(AccessToken).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ ttl: 14400 }),
      );
    });

    it('harus menambahkan VideoGrant dengan nama room yang benar', () => {
      service.generateToken('patient_001', 'room_konsultasi');
      const VideoGrant = AccessToken.VideoGrant;
      expect(VideoGrant).toHaveBeenCalledWith({ room: 'room_konsultasi' });
    });

    it('harus menerima TTL berbeda tanpa error', () => {
      const ttlValues = [300, 1800, 3600, 7200, 10800, 14400];
      ttlValues.forEach((ttl) => {
        expect(() => service.generateToken('identity', 'room', ttl)).not.toThrow();
      });
    });
  });
});
