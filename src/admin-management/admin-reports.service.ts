import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import type { ReportsQueryDto } from './dto/admin-reports.dto';

function getDateRange(query: ReportsQueryDto): { from: Date; to: Date } {
  if (query.dateFrom && query.dateTo) {
    return { from: new Date(query.dateFrom), to: new Date(query.dateTo + 'T23:59:59') };
  }

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (query.preset) {
    case 'today':
      return { from: today, to: new Date(today.getTime() + 86_400_000) };
    case '7days':
      return { from: new Date(today.getTime() - 6 * 86_400_000), to: new Date(today.getTime() + 86_400_000) };
    case '30days':
      return { from: new Date(today.getTime() - 29 * 86_400_000), to: new Date(today.getTime() + 86_400_000) };
    case 'thisMonth':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      };
    default:
      return { from: new Date(today.getTime() - 29 * 86_400_000), to: new Date(today.getTime() + 86_400_000) };
  }
}

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(tenantId: string, schemaName: string, query: ReportsQueryDto) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const { from, to } = getDateRange(query);

      const sessionWhere: any = {
        tenantId,
        scheduledStartTime: { gte: from, lt: to },
        ...(query.doctorId && { doctorId: query.doctorId }),
      };

      const [sessions, notes] = await Promise.all([
        tx.consultationSession.findMany({
          where: sessionWhere,
          select: {
            sessionId: true,
            sessionStatus: true,
            sessionType: true,
            scheduledStartTime: true,
            startedAt: true,
            endedAt: true,
            durationSec: true,
            doctorJoinedAt: true,
            patientJoinedAt: true,
            doctor: { select: { doctorProfile: { select: { serviceCapability: true } } } },
          },
        }),
        tx.consultationNote.findMany({
          where: {
            tenantId,
            createdAt: { gte: from, lt: to },
            ...(query.doctorId && { doctorId: query.doctorId }),
          },
          select: {
            aiStatus: true,
            isFinalized: true,
            summarizedAt: true,
          },
        }),
      ]);

      const total = sessions.length;
      const completed = sessions.filter((s) => s.sessionStatus === 'COMPLETED').length;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

      // Avg wait time (startedAt - scheduledStartTime) in minutes
      const waitTimes = sessions
        .filter((s) => s.startedAt)
        .map((s) => (s.startedAt!.getTime() - s.scheduledStartTime.getTime()) / 60_000);
      const avgWaitMin = waitTimes.length > 0 ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length) : 0;

      // Avg duration in minutes
      const durations = sessions.filter((s) => s.durationSec).map((s) => s.durationSec! / 60);
      const avgDurationMin = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

      // No-show: sessions where neither doctor nor patient joined
      const noShow = sessions.filter(
        (s) => s.sessionStatus !== 'COMPLETED' && !s.doctorJoinedAt && !s.patientJoinedAt,
      ).length;
      const noShowRate = total > 0 ? Math.round((noShow / total) * 100) : 0;

      // Cancelled (FAILED sessions)
      const cancelled = sessions.filter((s) => s.sessionStatus === 'FAILED').length;
      const cancelRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

      // Channel breakdown
      const telemedicine = sessions.filter(
        (s) => s.doctor.doctorProfile?.serviceCapability === 'TELEMEDICINE',
      ).length;
      const telecounseling = sessions.filter(
        (s) => s.doctor.doctorProfile?.serviceCapability === 'TELECOUNSELING',
      ).length;

      // Active doctors & nurses in range
      const activeDoctorIds = new Set(sessions.map((s) => s.doctor?.doctorProfile)).size;
      const doctorIds = [...new Set(
        sessions
          .filter((s) => s.sessionStatus === 'COMPLETED')
          .map((s) => s.sessionId),
      )].length;

      // AI metrics
      const aiSuccess = notes.filter((n) => n.aiStatus === 'SUCCESS').length;
      const aiFailed = notes.filter((n) => n.aiStatus === 'FAILED').length;
      const aiTotal = aiSuccess + aiFailed;
      const aiSuccessRate = aiTotal > 0 ? Math.round((aiSuccess / aiTotal) * 100) : 0;

      const soapDraft = notes.filter((n) => n.aiStatus === 'SUCCESS').length;
      const soapRevised = notes.filter((n) => n.aiStatus === 'SUCCESS' && n.summarizedAt).length;
      const soapFinalized = notes.filter((n) => n.isFinalized).length;

      // Active doctors in period
      const uniqueDoctors = new Set(sessions.map((s) => s.doctor?.doctorProfile)).size;

      return {
        period: { from: from.toISOString(), to: to.toISOString() },
        overview: {
          totalReservations: total,
          completedConsultations: completed,
          completionRate,
          avgWaitMinutes: avgWaitMin,
          avgDurationMinutes: avgDurationMin,
        },
        operational: {
          noShowCount: noShow,
          noShowRate,
          cancelledCount: cancelled,
          cancelRate,
          telemedicineCount: telemedicine,
          telecounselingCount: telecounseling,
          telemedicineRate: total > 0 ? Math.round((telemedicine / total) * 100) : 0,
          telecounselingRate: total > 0 ? Math.round((telecounseling / total) * 100) : 0,
          activeDoctors: uniqueDoctors,
        },
        aiMetrics: {
          successCount: aiSuccess,
          failedCount: aiFailed,
          successRate: aiSuccessRate,
          soapDraft,
          soapRevised,
          soapFinalized,
        },
      };
    });
  }

  async getDoctorOptions(tenantId: string, schemaName: string) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const doctors = await tx.doctorProfile.findMany({
        where: { tenantId },
        select: { userId: true, fullName: true },
        orderBy: { fullName: 'asc' },
      });
      return doctors;
    });
  }
}
