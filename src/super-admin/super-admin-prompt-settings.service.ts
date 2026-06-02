import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { UpdatePromptSettingDto } from './dto/update-prompt-setting.dto';

export type PromptTemplateType = 'SOAP' | 'DAP';

const SOAP_DEFAULTS = {
  subjective: `Gunakan format SOAP standar untuk S (Subjective), yang berisi informasi dari perspektif pasien:
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
"Tidak disebutkan dalam transkrip."`,

  objective: `Gunakan format SOAP standar untuk O (Objective), berisi temuan objektif:
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
"Belum ada data objektif yang disampaikan."`,

  assessment: `Gunakan format berikut untuk Assessment:
Diagnosis kerja:
1.
2.

Diagnosis banding:
1.
2.

ICD-9:
ICD-10:
SNOMED:`,

  plan: `Gunakan format SOAP standar untuk P (Plan), berisi rencana tindakan non-preskriptif kecuali dokter memang secara eksplisit memberikan instruksi.

Tampilkan Plan SELALU dalam format berikut:
Rencana pemeriksaan lanjutan:
Edukasi kepada pasien:
Rekomendasi gaya hidup:
Tindak lanjut/Follow-up:
Rencana rawat jalan, rawat inap, atau tindakan:
Konsultasi kebidang lain jika ada:
Terapi obat yang diberikan:`,
};

const DAP_DEFAULTS = {
  subjective: `Gunakan format DAP standar untuk D (Data), yang berisi informasi yang dikumpulkan selama sesi konseling:
- Laporan verbal klien (pikiran, perasaan, pengalaman yang disampaikan)
- Masalah atau tema yang diangkat klien
- Kemajuan atau hambatan yang dilaporkan sejak sesi terakhir
- Konteks kehidupan klien yang relevan

Tampilkan Data SELALU dalam format berikut:
Laporan klien:
Masalah/tema yang diangkat:
Kemajuan sejak sesi terakhir:
Konteks kehidupan yang relevan:

Jika ada data yang tidak disebutkan, tulis:
"Tidak disebutkan dalam transkrip."`,

  objective: '',

  assessment: `Gunakan format berikut untuk Assessment:
Formulasi klinis:

Kemajuan terhadap tujuan terapi:

Faktor risiko yang teridentifikasi:

Faktor protektif:

Diagnosis (DSM-5/ICD-10 jika relevan):`,

  plan: `Gunakan format DAP standar untuk P (Planning), berisi rencana intervensi konseling dan tindak lanjut.

Tampilkan Planning SELALU dalam format berikut:
Intervensi yang direncanakan:
Tugas/pekerjaan rumah untuk klien:
Tujuan untuk sesi berikutnya:
Jadwal sesi berikutnya:
Rujukan/konsultasi lain jika ada:`,
};

const DEFAULTS: Record<PromptTemplateType, typeof SOAP_DEFAULTS> = {
  SOAP: SOAP_DEFAULTS,
  DAP: DAP_DEFAULTS,
};

@Injectable()
export class SuperAdminPromptSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const [soap, dap] = await Promise.all([
      this.getOrCreateDefault('SOAP'),
      this.getOrCreateDefault('DAP'),
    ]);
    return { SOAP: soap, DAP: dap };
  }

  async findByType(type: PromptTemplateType) {
    return this.getOrCreateDefault(type);
  }

  async upsert(type: PromptTemplateType, dto: UpdatePromptSettingDto) {
    return this.prisma.promptSetting.upsert({
      where: { templateType: type },
      update: {
        subjective: dto.subjective,
        objective: dto.objective ?? '',
        assessment: dto.assessment,
        plan: dto.plan,
      },
      create: {
        templateType: type,
        subjective: dto.subjective,
        objective: dto.objective ?? '',
        assessment: dto.assessment,
        plan: dto.plan,
      },
    });
  }

  async resetToDefault(type: PromptTemplateType) {
    const defaults = DEFAULTS[type];
    return this.prisma.promptSetting.upsert({
      where: { templateType: type },
      update: defaults,
      create: { templateType: type, ...defaults },
    });
  }

  private async getOrCreateDefault(type: PromptTemplateType) {
    const existing = await this.prisma.promptSetting.findUnique({
      where: { templateType: type },
    });
    if (existing) return existing;

    return this.prisma.promptSetting.create({
      data: { templateType: type, ...DEFAULTS[type] },
    });
  }
}
