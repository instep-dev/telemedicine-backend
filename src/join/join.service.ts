import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from 'prisma/prisma.service';
import type { Response } from 'express';
import { TwilioService } from '../twilio/twilio.service';

interface TenantRow {
  id: string;
  slug: string;
  schema_name: string;
  name: string;
}

@Injectable()
export class JoinService {
  // SSE clients: sessionId -> Set of Response objects
  private readonly sseClients = new Map<string, Set<Response>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly twilio: TwilioService,
  ) {}

  private async resolveTenantBySlug(slug: string) {
    const rows = await this.prisma.$queryRaw<TenantRow[]>`
      SELECT id, slug, schema_name, name
      FROM public.tenant_registry
      WHERE slug = ${slug}
      LIMIT 1
    `;
    const tenant = rows[0];
    if (!tenant) throw new NotFoundException('Tenant tidak ditemukan');
    return { id: tenant.id, slug: tenant.slug, schemaName: tenant.schema_name, name: tenant.name };
  }

  async getPublicSessionInfo(sessionId: string, tenantSlug: string) {
    const tenant = await this.resolveTenantBySlug(tenantSlug);


    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findUnique({
        where: { sessionId },
        include: {
          doctor: {
            include: { doctorProfile: { select: { fullName: true, specialization: true } } },
          },
          patient: {
            include: { patientProfile: { select: { fullName: true } } },
          },
        },
      });
    });

    if (!session) throw new NotFoundException('Sesi tidak ditemukan');
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      throw new BadRequestException('Sesi sudah berakhir');
    }

    return {
      sessionId: session.sessionId,
      sessionStatus: session.sessionStatus,
      serviceType: session.serviceType,
      consultationMode: session.consultationMode,
      sessionType: session.sessionType,
      scheduledStartTime: session.scheduledStartTime,
      scheduledEndTime: session.scheduledEndTime,
      reasonForVisit: session.reasonForVisit,
      patientInstructions: session.patientInstructions,
      doctor: {
        name: session.doctor.doctorProfile?.fullName ?? session.doctor.name ?? 'Dokter',
        specialization: session.doctor.doctorProfile?.specialization ?? null,
      },
      tenantName: tenant.name,
    };
  }

  async checkIn(sessionId: string, tenantSlug: string, name: string) {
    if (!name?.trim()) throw new BadRequestException('Nama tidak boleh kosong');

    const tenant = await this.resolveTenantBySlug(tenantSlug);

    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findUnique({
        where: { sessionId },
        select: { sessionId: true, sessionStatus: true },
      });
    });

    if (!session) throw new NotFoundException('Sesi tidak ditemukan');
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      throw new BadRequestException('Sesi sudah berakhir');
    }

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId },
        data: { checkInName: name.trim() },
      });
    });

    return { ok: true };
  }

  async getPublicPatientToken(sessionId: string, tenantSlug: string, checkInName?: string) {
    const tenant = await this.resolveTenantBySlug(tenantSlug);

    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findUnique({
        where: { sessionId },
        include: {
          doctor: true,
          patient: { include: { patientProfile: true } },
          nurse: true,
        },
      });
    });

    if (!session) throw new NotFoundException('Sesi tidak ditemukan');
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      throw new BadRequestException('Sesi sudah berakhir');
    }

    const displayName = checkInName?.trim() || session.checkInName?.trim() || 'Pasien';
    const identity = `patient_${session.sessionId}_public`.slice(0, 128);

    return this.twilio.publicPatientToken(session, tenant, identity, displayName);
  }

  // ─── SSE ────────────────────────────────────────────────────────────────────

  addSseClient(sessionId: string, res: Response) {
    if (!this.sseClients.has(sessionId)) {
      this.sseClients.set(sessionId, new Set());
    }
    this.sseClients.get(sessionId)!.add(res);
  }

  removeSseClient(sessionId: string, res: Response) {
    this.sseClients.get(sessionId)?.delete(res);
  }

  @OnEvent('session.doctor_joined')
  handleDoctorJoined(payload: { sessionId: string }) {
    this.broadcastSessionUpdate(payload.sessionId, { type: 'doctor_joined' });
  }

  broadcastSessionUpdate(sessionId: string, data: object) {
    const clients = this.sseClients.get(sessionId);
    if (!clients || clients.size === 0) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }
}
