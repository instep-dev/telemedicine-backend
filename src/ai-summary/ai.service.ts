import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from 'prisma/prisma.service';
import type { TenantContext } from '../tenant/tenant.interface';
import { SummaryService } from './summary.service';

export const AI_STATUS_UPDATED_EVENT = 'ai.status.updated';

export interface AiStatusUpdatedPayload {
  noteId: string;
  sessionId: string;
  doctorId: string | null;
  nurseId: string | null;
  patientId: string | null;
  aiStatus: string;
  aiError: string | null;
  summary?: string | null;
  subjective?: string | null;
  objective?: string | null;
  assessment?: string | null;
  plan?: string | null;
  summarizedAt?: string | null;
  transcribedAt?: string | null;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly summaryService: SummaryService,
    private readonly events: EventEmitter2,
  ) {}

  async processConsultationFromTranscript(
    sessionId: string,
    doctorId?: string,
    tenant?: TenantContext,
  ) {
    // If no tenant provided, resolve by searching all active tenants
    const resolvedTenant = tenant ?? await this.resolveTenantForSession(sessionId);
    if (!resolvedTenant) {
      throw new Error(`Cannot resolve tenant for sessionId=${sessionId}`);
    }

    const consultationSession = await this.prisma.withTenantSchema(resolvedTenant.schemaName, async (tx) => {
      return tx.consultationSession.findUnique({
        where: { sessionId },
        include: { consultationNote: true },
      });
    });

    if (!consultationSession) {
      throw new Error(`Consultation session not found: ${sessionId}`);
    }

    if (doctorId && consultationSession.doctorId !== doctorId) {
      throw new ForbiddenException('Bukan milik dokter ini');
    }

    const currentStatus = String(consultationSession.consultationNote?.aiStatus ?? '')
      .trim()
      .toUpperCase();

    if (currentStatus === 'SUMMARIZING' || currentStatus === 'SUCCESS') {
      return;
    }

    const transcriptRaw = String(
      consultationSession.consultationNote?.transcriptRaw ?? '',
    ).trim();

    const nurseId = (consultationSession as any).nurseId ?? null;

    const emitEvent = (note: { id: string }, aiStatus: string, extra: Partial<AiStatusUpdatedPayload> = {}) => {
      const payload: AiStatusUpdatedPayload = {
        noteId: note.id,
        sessionId,
        doctorId: consultationSession.doctorId,
        nurseId,
        patientId: consultationSession.patientId,
        aiStatus,
        aiError: null,
        ...extra,
      };
      this.events.emit(AI_STATUS_UPDATED_EVENT, payload);
    };

    const upsertStatus = async (aiStatus: string, extra: Record<string, any> = {}) => {
      const result = await this.prisma.withTenantSchema(resolvedTenant.schemaName, async (tx) => {
        return tx.consultationNote.upsert({
          where: { consultationSessionId: sessionId },
          update: {
            doctorId: consultationSession.doctorId,
            aiStatus,
            aiError: null,
            ...extra,
          },
          create: {
            consultationSessionId: sessionId,
            tenantId: consultationSession.tenantId,
            doctorId: consultationSession.doctorId,
            patientId: consultationSession.patientId,
            aiStatus,
            aiError: null,
            ...extra,
          },
        });
      });
      emitEvent(result, aiStatus, extra);
      return result;
    };

    if (!transcriptRaw) {
      const result = await this.prisma.withTenantSchema(resolvedTenant.schemaName, async (tx) => {
        return tx.consultationNote.upsert({
          where: { consultationSessionId: sessionId },
          update: {
            doctorId: consultationSession.doctorId,
            aiStatus: 'FAILED',
            aiError: 'Transcript kosong. Tidak ada percakapan yang terdeteksi.',
          },
          create: {
            consultationSessionId: sessionId,
            tenantId: consultationSession.tenantId,
            doctorId: consultationSession.doctorId,
            patientId: consultationSession.patientId,
            aiStatus: 'FAILED',
            aiError: 'Transcript kosong. Tidak ada percakapan yang terdeteksi.',
          },
        });
      });

      emitEvent(result, 'FAILED', {
        aiError: 'Transcript kosong. Tidak ada percakapan yang terdeteksi.',
      });

      this.logger.warn(`Transcript empty for sessionId=${sessionId}`);
      return;
    }

    try {
      await upsertStatus('SUMMARIZING', {
        transcriptRaw,
        transcribedAt: consultationSession.consultationNote?.transcribedAt ?? new Date(),
      });

      const summary = await this.summaryService.createMedicalSummary(transcriptRaw);

      const summarizedAt = new Date();
      const transcribedAt =
        consultationSession.consultationNote?.transcribedAt ?? new Date();

      const result = await this.prisma.withTenantSchema(resolvedTenant.schemaName, async (tx) => {
        return tx.consultationNote.upsert({
          where: { consultationSessionId: sessionId },
          update: {
            doctorId: consultationSession.doctorId,
            transcriptRaw,
            summary: summary.summary,
            subjective: summary.subjective,
            objective: summary.objective,
            assessment: summary.assessment,
            plan: summary.plan,
            aiStatus: 'SUCCESS',
            aiError: null,
            summarizedAt,
            transcribedAt,
          },
          create: {
            consultationSessionId: sessionId,
            tenantId: consultationSession.tenantId,
            doctorId: consultationSession.doctorId,
            patientId: consultationSession.patientId,
            transcriptRaw,
            summary: summary.summary,
            subjective: summary.subjective,
            objective: summary.objective,
            assessment: summary.assessment,
            plan: summary.plan,
            aiStatus: 'SUCCESS',
            aiError: null,
            summarizedAt,
            transcribedAt,
          },
        });
      });

      emitEvent(result, 'SUCCESS', {
        summary: summary.summary,
        subjective: summary.subjective,
        objective: summary.objective,
        assessment: summary.assessment,
        plan: summary.plan,
        summarizedAt: summarizedAt.toISOString(),
        transcribedAt: transcribedAt instanceof Date
          ? transcribedAt.toISOString()
          : transcribedAt,
      });

      this.logger.log(`AI summary completed for sessionId=${sessionId}`);
    } catch (error: any) {
      this.logger.error(
        `AI summary failed sessionId=${sessionId} message=${error?.message || error}`,
      );

      const result = await this.prisma.withTenantSchema(resolvedTenant.schemaName, async (tx) => {
        return tx.consultationNote.upsert({
          where: { consultationSessionId: sessionId },
          update: {
            doctorId: consultationSession.doctorId,
            aiStatus: 'FAILED',
            aiError: error?.message || String(error),
          },
          create: {
            consultationSessionId: sessionId,
            tenantId: consultationSession.tenantId,
            doctorId: consultationSession.doctorId,
            patientId: consultationSession.patientId,
            aiStatus: 'FAILED',
            aiError: error?.message || String(error),
          },
        });
      });

      emitEvent(result, 'FAILED', { aiError: error?.message || String(error) });

      throw error;
    }
  }

  // Fallback: scan all tenants when no tenant context is available (e.g. manual retry)
  private async resolveTenantForSession(sessionId: string): Promise<TenantContext | null> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; slug: string; schema_name: string }>>`
      SELECT id, slug, schema_name FROM public.tenant_registry WHERE status = 'active'
    `;

    for (const row of rows) {
      const tenant: TenantContext = { id: row.id, slug: row.slug, schemaName: row.schema_name };
      const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        return tx.consultationSession.findUnique({
          where: { sessionId },
          select: { sessionId: true },
        });
      });
      if (session) return tenant;
    }

    return null;
  }
}
