import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

export type AnalyticsPeriod = '12months' | '30days' | '7days' | '24hours';

@Injectable()
export class SuperAdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const tenants = await this.prisma.tenantRegistry.findMany({
      select: { id: true, schemaName: true },
    });

    let totalUsers = 0;
    let totalCompletedConsultations = 0;
    let aiInProgress = 0;
    let aiSuccess = 0;
    let aiFailed = 0;

    await Promise.all(
      tenants.map(async ({ id: tenantId, schemaName }) => {
        try {
          await this.prisma.withTenantSchema(schemaName, async (tx) => {
            const [userCount, completedCount, inProgressCount, successCount, failedCount] = await Promise.all([
              tx.user.count({ where: { tenantId } }),
              tx.consultationSession.count({
                where: { tenantId, sessionStatus: 'COMPLETED' as any },
              }),
              tx.consultationNote.count({
                where: { tenantId, isFinalized: false, aiStatus: 'SUMMARIZING' },
              }),
              tx.consultationNote.count({
                where: {
                  tenantId,
                  OR: [{ aiStatus: 'SUCCESS' }, { isFinalized: true }],
                },
              }),
              tx.consultationNote.count({
                where: { tenantId, isFinalized: false, aiStatus: 'FAILED' },
              }),
            ]);

            totalUsers += userCount;
            totalCompletedConsultations += completedCount;
            aiInProgress += inProgressCount;
            aiSuccess += successCount;
            aiFailed += failedCount;
          });
        } catch {
          // skip broken schemas
        }
      }),
    );

    return {
      totalUsers,
      totalCompletedConsultations,
      aiJobs: {
        inProgress: aiInProgress,
        success: aiSuccess,
        failed: aiFailed,
        total: aiInProgress + aiSuccess + aiFailed,
      },
    };
  }

  async getRecentJobs(limit = 5) {
    const tenants = await this.prisma.tenantRegistry.findMany({
      select: { id: true, schemaName: true, name: true },
    });

    type JobRow = {
      id: string;
      tenantName: string;
      aiStatus: string | null;
      isFinalized: boolean;
      aiError: string | null;
      createdAt: Date;
      updatedAt: Date;
    };

    const allJobs: JobRow[] = [];

    await Promise.all(
      tenants.map(async ({ id: tenantId, schemaName, name: tenantName }) => {
        try {
          await this.prisma.withTenantSchema(schemaName, async (tx) => {
            const notes = await tx.consultationNote.findMany({
              where: {
                tenantId,
                aiStatus: { in: ['SUMMARIZING', 'SUCCESS', 'FAILED'] },
              },
              select: {
                id: true,
                aiStatus: true,
                isFinalized: true,
                aiError: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { updatedAt: 'desc' },
              take: limit,
            });

            for (const note of notes) {
              allJobs.push({
                ...note,
                tenantName,
                aiStatus: note.isFinalized ? 'SUCCESS' : note.aiStatus,
              });
            }
          });
        } catch {
          // skip
        }
      }),
    );

    return allJobs
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, limit);
  }

  async getAnalytics(period: AnalyticsPeriod): Promise<{ categories: string[]; data: number[] }> {
    const tenants = await this.prisma.tenantRegistry.findMany({
      select: { id: true, schemaName: true },
    });

    const now = new Date();
    let startDate: Date;
    let endDate: Date;

    if (period === '12months') {
      // Jan 1 s/d Des 31 tahun berjalan
      startDate = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      endDate   = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    } else if (period === '30days') {
      // Bulan berjalan: tanggal 1 s/d akhir bulan
      startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      endDate   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (period === '7days') {
      // Minggu berjalan: Senin s/d Minggu
      const jsDay = now.getDay(); // 0=Sun,1=Mon,...,6=Sat
      const daysFromMonday = jsDay === 0 ? 6 : jsDay - 1;
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      startDate.setDate(startDate.getDate() - daysFromMonday);
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Hari ini: 00:00 s/d 23:59
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(now);
      endDate.setHours(23, 59, 59, 999);
    }

    const timestamps: Date[] = [];

    await Promise.all(
      tenants.map(async ({ id: tenantId, schemaName }) => {
        try {
          await this.prisma.withTenantSchema(schemaName, async (tx) => {
            const sessions = await tx.consultationSession.findMany({
              where: {
                tenantId,
                sessionStatus: 'COMPLETED' as any,
                updatedAt: { gte: startDate, lte: endDate },
              },
              select: { updatedAt: true },
            });
            sessions.forEach((s) => timestamps.push(s.updatedAt));
          });
        } catch { /* skip broken schemas */ }
      }),
    );

    return this.buildAnalyticsBuckets(period, now, timestamps);
  }

  private buildAnalyticsBuckets(
    period: AnalyticsPeriod,
    now: Date,
    timestamps: Date[],
  ): { categories: string[]; data: number[] } {
    // 12 months → Jan-Des tahun ini, group per bulan
    if (period === '12months') {
      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const counts = new Array(12).fill(0);
      for (const ts of timestamps) counts[ts.getMonth()]++;
      return { categories: MONTHS, data: counts };
    }

    // 30 days → bulan berjalan, group per tanggal (1 s/d akhir bulan)
    if (period === '30days') {
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const counts = new Array(lastDay).fill(0);
      for (const ts of timestamps) counts[ts.getDate() - 1]++;
      const categories = Array.from({ length: lastDay }, (_, i) => String(i + 1));
      return { categories, data: counts };
    }

    // 7 days → minggu berjalan, group per hari (Mon=0 ... Sun=6)
    if (period === '7days') {
      const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const counts = new Array(7).fill(0);
      // JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat → index Mon=0 ... Sun=6
      const jsToIdx: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
      for (const ts of timestamps) counts[jsToIdx[ts.getDay()]]++;
      return { categories: DAY_LABELS, data: counts };
    }

    // 24 hours → hari ini, group per jam (0-23)
    const counts = new Array(24).fill(0);
    for (const ts of timestamps) counts[ts.getHours()]++;
    const categories = Array.from({ length: 24 }, (_, i) => `${i}:00`);
    return { categories, data: counts };
  }
}
