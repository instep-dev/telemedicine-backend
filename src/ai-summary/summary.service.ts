import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

export interface SoapSummaryResult {
  summary: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

export interface PromptConfig {
  templateType: 'SOAP' | 'DAP';
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Ringkasan medis singkat dan padat dari konsultasi.',
    },
    subjective: {
      type: 'string',
      description: 'Bagian SOAP Subjective: keluhan, gejala, riwayat yang disampaikan pasien.',
    },
    objective: {
      type: 'string',
      description:
        'Bagian SOAP Objective: temuan objektif, pemeriksaan, vital sign, observasi. Jika tidak ada, nyatakan tidak disebutkan.',
    },
    assessment: {
      type: 'string',
      description:
        'Bagian SOAP Assessment: penilaian klinis berdasarkan transkrip. Jangan mengarang diagnosis yang tidak didukung.',
    },
    plan: {
      type: 'string',
      description:
        'Bagian SOAP Plan: rencana terapi, edukasi, follow-up, instruksi. Jika tidak ada, nyatakan observasi/follow-up sesuai kondisi klinis.',
    },
  },
  required: ['summary', 'subjective', 'objective', 'assessment', 'plan'],
};

@Injectable()
export class SummaryService {
  private readonly logger = new Logger(SummaryService.name);
  private readonly ai: GoogleGenAI;

  // Model chain: primary first, then fallbacks. Configurable via env.
  // - Primary  : GEMINI_MODEL (default: gemini-2.5-flash)
  // - Fallbacks: GEMINI_FALLBACK_MODELS (default: gemini-2.0-flash,gemini-1.5-flash)
  private readonly modelChain: string[];

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new InternalServerErrorException('GEMINI_API_KEY is not set');
    }
    this.ai = new GoogleGenAI({ apiKey });

    const primary = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const rawFallbacks =
      process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-2.0-flash,gemini-1.5-flash';
    const fallbacks = rawFallbacks
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    // Deduplicate: primary always first, remove duplicates in fallbacks
    this.modelChain = [primary, ...fallbacks.filter((m) => m !== primary)];
    this.logger.log(`Model chain initialized: [${this.modelChain.join(' → ')}]`);
  }

  async createMedicalSummary(
    transcript: string,
    config?: PromptConfig,
  ): Promise<SoapSummaryResult> {
    const cleanTranscript = this.normalizeTranscript(transcript);

    if (!cleanTranscript) {
      return {
        summary: 'Transkrip kosong atau tidak terbaca.',
        subjective: 'Keluhan pasien tidak dapat diidentifikasi karena transkrip kosong.',
        objective: 'Tidak ada data objektif yang dapat diekstrak dari transkrip.',
        assessment: 'Tidak dapat membuat assessment karena data tidak cukup.',
        plan: 'Periksa kembali hasil rekaman audio dan proses transkripsi.',
      };
    }

    const prompt = this.buildPrompt(cleanTranscript, config);
    let lastError: any;

    for (let modelIdx = 0; modelIdx < this.modelChain.length; modelIdx++) {
      const model = this.modelChain[modelIdx];
      const isLastModel = modelIdx === this.modelChain.length - 1;

      try {
        const response = await this.withRetry(
          () => this.callGemini(model, prompt),
          4, // initial attempt + 3 retries per model
          model,
        );

        const rawText = String(response.text || '').trim();
        if (!rawText) throw new Error('Empty Gemini response');

        const parsed = this.safeJsonParse(rawText);

        this.logger.log(`AI summary completed model=${model}`);

        return {
          summary: this.cleanField(
            parsed.summary,
            'Ringkasan konsultasi tidak berhasil dibuat.',
          ),
          subjective: this.cleanField(
            parsed.subjective,
            'Keluhan subjektif tidak cukup jelas pada transkrip.',
          ),
          objective: this.cleanField(
            parsed.objective,
            'Data objektif tidak disebutkan secara jelas pada transkrip.',
          ),
          assessment: this.cleanField(
            parsed.assessment,
            'Assessment definitif tidak dapat dibuat hanya dari transkrip.',
          ),
          plan: this.cleanField(
            parsed.plan,
            'Lanjutkan observasi gejala, edukasi pasien, dan follow-up sesuai kondisi klinis.',
          ),
        };
      } catch (error: any) {
        lastError = error;
        const status = this.extractHttpStatus(error);
        const isCapacityError = status === 503 || status === 429;

        if (isCapacityError && !isLastModel) {
          this.logger.warn(
            `Model ${model} exhausted all retries (HTTP ${status}), switching to next model...`,
          );
          continue;
        }

        // Non-capacity error, or this was the last model — stop here
        break;
      }
    }

    this.logger.error(
      `All models in chain failed. Last error: ${lastError?.message || lastError}`,
    );
    throw new InternalServerErrorException(
      `Gemini summary generation failed: ${lastError?.message || String(lastError)}`,
    );
  }

  // ─── Internal helpers ────────────────────────────────────────────────────────

  private callGemini(model: string, prompt: string) {
    return this.ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
      },
    });
  }

  /**
   * Retry with exponential backoff + jitter.
   * Delays: ~1s → ~2s → ~4s (each ±25% jitter).
   * Retries only on 503 (High Demand) and 429 (Rate Limit).
   * Respects Retry-After header when present.
   */
  private async withRetry<T>(
    fn: () => Promise<T>,
    maxAttempts: number,
    modelName: string,
  ): Promise<T> {
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        const status = this.extractHttpStatus(error);
        const isRetryable = status === 503 || status === 429;

        if (!isRetryable || attempt === maxAttempts) throw error;

        const delayMs = this.calcDelay(attempt, error);
        this.logger.warn(
          `Gemini HTTP ${status} model=${modelName} attempt ${attempt}/${maxAttempts}, retry in ${delayMs}ms`,
        );
        await this.sleep(delayMs);
        lastError = error;
      }
    }

    throw lastError;
  }

  /**
   * Exponential backoff: base = 2^(attempt-1) seconds, capped at 30s.
   * Jitter: ±25% so concurrent jobs don't all retry at the same time.
   * Respects Retry-After header from Google if present.
   */
  private calcDelay(attempt: number, error: any): number {
    const retryAfterHeader =
      error?.response?.headers?.['retry-after'] ??
      error?.headers?.['retry-after'];

    if (retryAfterHeader && !isNaN(Number(retryAfterHeader))) {
      return Math.min(Number(retryAfterHeader) * 1_000, 60_000);
    }

    const base = Math.min(Math.pow(2, attempt - 1) * 1_000, 30_000);
    const jitter = base * 0.25 * (Math.random() * 2 - 1); // ±25%
    return Math.max(500, Math.round(base + jitter));
  }

  private extractHttpStatus(error: any): number | null {
    return (
      error?.status ??
      error?.response?.status ??
      error?.httpStatusCode ??
      null
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // ─── Prompt builder ───────────────────────────────────────────────────────────

  private buildPrompt(transcript: string, config?: PromptConfig): string {
    const isDAP = config?.templateType === 'DAP';

    const subjective = config?.subjective ?? `Gunakan format SOAP standar untuk S (Subjective), yang berisi informasi dari perspektif pasien:
- keluhan utama
- riwayat keluhan
- durasi
- faktor pencetus/pereda
- riwayat penyakit sebelumnya
- alergi
- obat yang sedang dikonsumsi
- informasi tambahan dari pasien

Tampilkan Subjective SELALU dalam format berikut:
Keluhan utama:
Riwayat keluhan:
Durasi:
Faktor pencetus/pereda:
Riwayat penyakit sebelumnya:
Alergi:
Obat yang sedang dikonsumsi:
Informasi tambahan dari pasien:

Jika ada data yang tidak disebutkan, tulis:
"Tidak disebutkan dalam transkrip."`;

    const objective = config?.objective ?? `Gunakan format SOAP standar untuk O (Objective), berisi temuan objektif:
- tanda vital
- pemeriksaan fisik
- hasil lab/radiologi
- observasi lainnya

Tampilkan Objective SELALU dalam format berikut:
Tanda vital:
Pemeriksaan fisik:
Hasil lab/radiologi:
Observasi lainnya:

Jika data objektif tidak tersedia, tulis dengan jelas:
"Belum ada data objektif yang disampaikan."`;

    const assessment = config?.assessment ?? `Gunakan format berikut untuk Assessment:
Diagnosis kerja:
1.
2.

Diagnosis banding:
1.
2.

ICD-9:
ICD-10:
SNOMED:`;

    const plan = config?.plan ?? `Gunakan format SOAP standar untuk P (Plan), berisi rencana tindakan non-preskriptif kecuali dokter memang secara eksplisit memberikan instruksi.

Tampilkan Plan SELALU dalam format berikut:
Rencana pemeriksaan lanjutan:
Edukasi kepada pasien:
Rekomendasi gaya hidup:
Tindak lanjut/Follow-up:
Rencana rawat jalan, rawat inap, atau tindakan:
Konsultasi kebidang lain jika ada:
Terapi obat yang diberikan:`;

    const summaryInstruction = isDAP
      ? 'Ringkasan singkat dan klinis dari sesi konseling yang telah berlangsung, mencakup tema utama dan perkembangan klien.'
      : 'Ringkasan medis singkat, klinis, padat, dan relevan dari hasil konsultasi.';

    const objectiveSection = isDAP ? '' : `

3. objective
${objective}`;

    const sectionOffset = isDAP ? 2 : 3;

    const assessmentRules = isDAP
      ? `Aturan assessment:
- Buat formulasi klinis berdasarkan data yang dikumpulkan selama sesi.
- Jangan mengarang diagnosis yang tidak didukung data.
- Jika data tidak cukup, nyatakan dengan jelas bahwa assessment terbatas oleh transkrip.`
      : `Aturan assessment:
- Buat maksimal dua diagnosis kerja jika memang didukung transkrip.
- Buat minimal dua diagnosis banding jika memang masuk akal berdasarkan transkrip.
- Jangan mengarang diagnosis yang tidak didukung data.
- Jika data tidak cukup, nyatakan dengan jelas bahwa assessment terbatas oleh transkrip.
- Jika kode ICD-9, ICD-10, atau SNOMED tidak dapat ditentukan dengan yakin dari data yang tersedia, tulis:
  "Tidak dapat ditentukan secara pasti dari transkrip."

Jika pasien adalah ibu hamil, gunakan format tambahan:
Gravida Partus Abortus:
Usia kehamilan:
Janin tunggal/multiple:
Janin hidup intra/extra uterin:
Diagnosis patologis:

Jika konteks kehamilan tidak disebutkan, jangan dipaksakan.`;

    const planRules = isDAP
      ? `Aturan planning:
- Fokus pada intervensi konseling dan rencana sesi berikutnya.
- Jika suatu bagian tidak disebutkan, tulis:
  "Tidak disebutkan dalam transkrip."`
      : `Aturan plan:
- Tidak memberikan resep obat tanpa instruksi eksplisit dari dokter.
- Jika suatu bagian tidak disebutkan, tulis:
  "Tidak disebutkan dalam transkrip."`;

    return `You are a careful ${isDAP ? 'counseling' : 'medical'} scribe assistant for telemedicine consultations.

Tugas utama:
Analisis transkrip konsultasi berikut dan hasilkan output dalam format JSON yang valid.

Struktur yang wajib dihasilkan:

1. summary
${summaryInstruction}

2. subjective
${subjective}${objectiveSection}

${sectionOffset}. assessment
${assessment}

${assessmentRules}

${sectionOffset + 1}. plan
${plan}

${planRules}

Important rules:
- Return valid JSON only.
- Do not include markdown fences.
- Do not invent findings or diagnosis if they are not supported by the transcript.
- If objective data is missing, state clearly that objective findings were not explicitly mentioned.
- If assessment is uncertain, say it is limited by the transcript.
- Keep the tone clinical, concise, and useful for a consultation note.
- Preserve the original language of the transcript when reasonable. If the transcript is mixed Indonesian-English, output may also be mixed naturally.

JSON output schema:
{
  "summary": "string",
  "subjective": "string",
  "objective": "string",
  "assessment": "string",
  "plan": "string"
}

Transcript:
${transcript}`.trim();
  }

  // ─── Utility ──────────────────────────────────────────────────────────────────

  private normalizeTranscript(text: string): string {
    return String(text || '')
      .replace(/ /g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private safeJsonParse(raw: string): Record<string, any> {
    try {
      return JSON.parse(raw);
    } catch {
      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      return JSON.parse(cleaned);
    }
  }

  private cleanField(value: unknown, fallback: string): string {
    const result = String(value ?? '')
      .replace(/ /g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return result || fallback;
  }
}
