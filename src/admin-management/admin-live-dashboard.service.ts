import { Injectable, MessageEvent, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { writeAuditLog } from './audit.helper';
import { Observable } from 'rxjs';

@Injectable()
export class AdminLiveDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(tenantId: string, schemaName: string) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const jakartaNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
      const todayStart = new Date(jakartaNow.getFullYear(), jakartaNow.getMonth(), jakartaNow.getDate());
      const todayEnd = new Date(todayStart.getTime() + 86_400_000);

      const [totalToday, inCall, completed] = await Promise.all([
        tx.consultationSession.count({
          where: { tenantId, scheduledStartTime: { gte: todayStart, lt: todayEnd } },
        }),
        tx.consultationSession.count({
          where: { tenantId, sessionStatus: 'IN_CALL' },
        }),
        tx.consultationSession.count({
          where: { tenantId, sessionStatus: 'COMPLETED', endedAt: { gte: todayStart, lt: todayEnd } },
        }),
      ]);

      // Waiting = CREATED and scheduled to start in next 2 hours
      const twoHoursLater = new Date(jakartaNow.getTime() + 2 * 3_600_000);
      const waiting = await tx.consultationSession.count({
        where: {
          tenantId,
          sessionStatus: 'CREATED',
          scheduledStartTime: { lte: twoHoursLater },
        },
      });

      return { totalToday, inCall, waiting, completed };
    });
  }

  async getStuckSessions(tenantId: string, schemaName: string) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const now = new Date();

      const stuck = await tx.consultationSession.findMany({
        where: {
          tenantId,
          sessionStatus: { in: ['CREATED', 'IN_CALL'] },
          OR: [
            // Scheduled session past end time
            { scheduledEndTime: { lt: now } },
            // Scheduled session started more than 3 hours ago
            { scheduledStartTime: { lt: new Date(now.getTime() - 3 * 3_600_000) }, sessionStatus: 'CREATED' },
          ],
        },
        orderBy: { scheduledStartTime: 'asc' },
        take: 50,
        select: {
          sessionId: true,
          tenantId: true,
          sessionStatus: true,
          sessionType: true,
          scheduledStartTime: true,
          scheduledEndTime: true,
          startedAt: true,
          endedAt: true,
          doctor: { select: { name: true, doctorProfile: { select: { specialization: true, serviceCapability: true } } } },
          patient: { select: { name: true, patientProfile: { select: { mrn: true } } } },
        },
      });

      return stuck.map((s) => ({
        sessionId: s.sessionId,
        status: s.sessionStatus,
        sessionType: s.sessionType,
        scheduledStartTime: s.scheduledStartTime,
        scheduledEndTime: s.scheduledEndTime,
        startedAt: s.startedAt,
        doctorName: s.doctor.name,
        serviceCapability: s.doctor.doctorProfile?.serviceCapability ?? null,
        patientName: s.patient.name,
        mrn: s.patient.patientProfile?.mrn ?? null,
        minutesLate: Math.floor((now.getTime() - s.scheduledStartTime.getTime()) / 60_000),
      }));
    });
  }

  async forceComplete(
    tenantId: string,
    schemaName: string,
    sessionId: string,
    actor: { id: string; name: string; role: string },
  ) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const session = await tx.consultationSession.findFirst({
        where: { sessionId, tenantId },
      });
      if (!session) throw new NotFoundException('Sesi tidak ditemukan');

      const updated = await tx.consultationSession.update({
        where: { sessionId },
        data: {
          sessionStatus: 'COMPLETED',
          endedAt: new Date(),
        },
        select: { sessionId: true, sessionStatus: true },
      });

      await tx.consultationSessionAudit.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          consultationSessionId: sessionId,
          actorUserId: actor.id,
          actorRole: 'ADMIN' as any,
          action: 'ADMIN_FORCE_COMPLETE',
          previousStatus: session.sessionStatus as any,
          newStatus: 'COMPLETED' as any,
          metadata: { reason: 'Force completed by admin via live dashboard' },
        },
      });

      await writeAuditLog(this.prisma, schemaName, {
        tenantId, actorId: actor.id, actorName: actor.name, actorRole: actor.role,
        action: 'FORCE_COMPLETE_SESSION', targetType: 'SESSION', targetId: sessionId,
        metadata: { previousStatus: session.sessionStatus },
      });

      return updated;
    });
  }

  async getRecentSessions(tenantId: string, schemaName: string, search?: string, status?: string) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const where: any = {
        tenantId,
        ...(status && status !== 'ALL' && { sessionStatus: status }),
      };

      const sessions = await tx.consultationSession.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          sessionId: true,
          sessionStatus: true,
          sessionType: true,
          scheduledStartTime: true,
          scheduledEndTime: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
          doctor: {
            select: {
              name: true,
              doctorProfile: { select: { serviceCapability: true } },
            },
          },
          patient: {
            select: {
              name: true,
              patientProfile: { select: { mrn: true } },
            },
          },
        },
      });

      return sessions.map((s) => ({
        sessionId: s.sessionId,
        status: s.sessionStatus,
        sessionType: s.sessionType,
        scheduledStartTime: s.scheduledStartTime,
        scheduledEndTime: s.scheduledEndTime,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        durationSec: s.durationSec,
        doctorName: s.doctor.name,
        serviceCapability: s.doctor.doctorProfile?.serviceCapability ?? null,
        patientName: s.patient.name,
        mrn: s.patient.patientProfile?.mrn ?? null,
      }));
    });
  }

  getStream(tenantId: string, schemaName: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const push = async () => {
        try {
          const [stats, stuck, recent] = await Promise.all([
            this.getStats(tenantId, schemaName),
            this.getStuckSessions(tenantId, schemaName),
            this.getRecentSessions(tenantId, schemaName),
          ]);
          subscriber.next({
            data: JSON.stringify({ stats, stuck, recent }),
          } as MessageEvent);
        } catch {
          // transient DB error — skip this tick, stream stays alive
        }
      };

      push();
      const interval = setInterval(push, 5_000);

      return () => clearInterval(interval);
    });
  }
}
