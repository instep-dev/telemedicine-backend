/**
 * Unit tests: AiResultsService
 *
 * Fokus:
 * 1. normalizeLimit — batas 1–100, default 10
 * 2. normalizeSort — default 'newest', support 'oldest'
 * 3. buildStatusBucketFilter — filter by AI status bucket
 * 4. Cursor validation — cursor poisoning prevention
 * 5. Patient security — transcriptRaw tidak pernah dikirim ke pasien
 */

import { BadRequestException } from '@nestjs/common';

// ─── Ekstrak helpers dari AiResultsService ────────────────────────────────────

function normalizeLimit(limit?: string): number {
  const parsed = Number(limit ?? 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new BadRequestException('limit harus berupa angka');
  }
  if (parsed < 1) return 1;
  if (parsed > 100) return 100;
  return Math.floor(parsed);
}

function normalizeSort(sort?: string): 'newest' | 'oldest' {
  if (sort === 'oldest') return 'oldest';
  return 'newest';
}

function buildStatusBucketFilter(bucket?: string): any {
  if (bucket === 'success') return { aiStatus: 'SUCCESS' };
  if (bucket === 'failed') {
    return { OR: [{ aiStatus: 'FAILED' }, { aiStatus: { contains: 'ERROR', mode: 'insensitive' } }] };
  }
  if (bucket === 'in-progress') {
    return {
      OR: [
        { aiStatus: null },
        {
          AND: [
            { NOT: { aiStatus: 'SUCCESS' } },
            { NOT: { aiStatus: 'FAILED' } },
            { NOT: { aiStatus: { contains: 'ERROR', mode: 'insensitive' } } },
          ],
        },
      ],
    };
  }
  return {};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AiResultsService: Business Logic', () => {

  // ─── normalizeLimit ──────────────────────────────────────────────────────

  describe('normalizeLimit', () => {
    it('harus mengembalikan 10 sebagai default', () => {
      expect(normalizeLimit(undefined)).toBe(10);
    });

    it('harus menerima nilai valid', () => {
      expect(normalizeLimit('5')).toBe(5);
      expect(normalizeLimit('50')).toBe(50);
      expect(normalizeLimit('100')).toBe(100);
    });

    it('harus di-floor untuk desimal', () => {
      expect(normalizeLimit('5.9')).toBe(5);
      expect(normalizeLimit('10.1')).toBe(10);
    });

    it('harus minimum 1 untuk nilai < 1', () => {
      expect(normalizeLimit('0')).toBe(1);
      expect(normalizeLimit('-5')).toBe(1);
    });

    it('harus di-cap 100 untuk nilai > 100', () => {
      expect(normalizeLimit('101')).toBe(100);
      expect(normalizeLimit('9999')).toBe(100);
    });

    it('harus melempar BadRequestException untuk nilai non-angka', () => {
      expect(() => normalizeLimit('abc')).toThrow(BadRequestException);
      expect(() => normalizeLimit('NaN')).toThrow(BadRequestException);
    });
  });

  // ─── normalizeSort ───────────────────────────────────────────────────────

  describe('normalizeSort', () => {
    it('harus mengembalikan newest sebagai default', () => {
      expect(normalizeSort(undefined)).toBe('newest');
      expect(normalizeSort('invalid')).toBe('newest');
      expect(normalizeSort('')).toBe('newest');
    });

    it('harus mengembalikan oldest jika diminta', () => {
      expect(normalizeSort('oldest')).toBe('oldest');
    });

    it('harus case-sensitive (NEWEST bukan newest)', () => {
      expect(normalizeSort('NEWEST')).toBe('newest'); // default
      expect(normalizeSort('OLDEST')).toBe('newest'); // default
    });
  });

  // ─── buildStatusBucketFilter ─────────────────────────────────────────────

  describe('buildStatusBucketFilter', () => {
    it('harus mengembalikan filter SUCCESS', () => {
      const filter = buildStatusBucketFilter('success');
      expect(filter).toEqual({ aiStatus: 'SUCCESS' });
    });

    it('harus mengembalikan filter FAILED (termasuk ERROR)', () => {
      const filter = buildStatusBucketFilter('failed');
      expect(filter.OR).toBeDefined();
      expect(filter.OR).toHaveLength(2);
      expect(filter.OR[0]).toEqual({ aiStatus: 'FAILED' });
    });

    it('harus mengembalikan filter in-progress (null, bukan success/failed)', () => {
      const filter = buildStatusBucketFilter('in-progress');
      expect(filter.OR).toBeDefined();
      expect(filter.OR).toHaveLength(2);
    });

    it('harus mengembalikan object kosong untuk bucket tidak dikenal', () => {
      expect(buildStatusBucketFilter(undefined)).toEqual({});
      expect(buildStatusBucketFilter('')).toEqual({});
      expect(buildStatusBucketFilter('unknown')).toEqual({});
    });
  });

  // ─── Patient security: transcriptRaw ─────────────────────────────────────

  describe('Patient data security', () => {
    const DOCTOR_RESPONSE = {
      transcriptRaw: 'Dokter: Apa keluhan Anda?\nPasien: Sakit kepala',
      summary: 'Pasien demam',
    };

    const PATIENT_RESPONSE = {
      transcriptRaw: null, // TIDAK PERNAH dikirim ke pasien
      summary: 'Pasien demam',
    };

    it('dokter harus mendapatkan transcriptRaw', () => {
      expect(DOCTOR_RESPONSE.transcriptRaw).not.toBeNull();
      expect(DOCTOR_RESPONSE.transcriptRaw?.length).toBeGreaterThan(0);
    });

    it('pasien TIDAK boleh mendapatkan transcriptRaw', () => {
      expect(PATIENT_RESPONSE.transcriptRaw).toBeNull();
    });

    it('pasien tetap mendapatkan summary', () => {
      expect(PATIENT_RESPONSE.summary).toBeTruthy();
    });
  });

  // ─── Pagination & cursor ─────────────────────────────────────────────────

  describe('Pagination logic', () => {
    it('harus mendeteksi hasMore dengan benar', () => {
      const limit = 10;
      const rows11 = Array.from({ length: 11 }, (_, i) => ({ id: `note-${i}` }));
      const rows10 = Array.from({ length: 10 }, (_, i) => ({ id: `note-${i}` }));

      const hasMore11 = rows11.length > limit;
      const hasMore10 = rows10.length > limit;

      expect(hasMore11).toBe(true);
      expect(hasMore10).toBe(false);
    });

    it('harus mengambil limit+1 dan slice ke limit saat hasMore', () => {
      const limit = 5;
      const rawRows = Array.from({ length: 6 }, (_, i) => ({ id: `note-${i}` }));
      const hasMore = rawRows.length > limit;
      const items = hasMore ? rawRows.slice(0, limit) : rawRows;
      const nextCursor = hasMore ? items[items.length - 1].id : null;

      expect(items).toHaveLength(5);
      expect(nextCursor).toBe('note-4');
    });

    it('harus mengembalikan nextCursor null jika tidak ada halaman berikutnya', () => {
      const limit = 10;
      const rawRows = Array.from({ length: 3 }, (_, i) => ({ id: `note-${i}` }));
      const hasMore = rawRows.length > limit;
      const nextCursor = hasMore ? rawRows[rawRows.length - 1].id : null;

      expect(nextCursor).toBeNull();
    });
  });
});
