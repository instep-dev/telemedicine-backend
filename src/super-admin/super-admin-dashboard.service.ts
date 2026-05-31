import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';

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
            const [userCount, completedCount, aiCounts] = await Promise.all([
              tx.user.count({ where: { tenantId } }),
              tx.consultationSession.count({
                where: { tenantId, sessionStatus: 'COMPLETED' as any },
              }),
              tx.consultationNote.groupBy({
                by: ['aiStatus'],
                where: {
                  tenantId,
                  aiStatus: { in: ['SUMMARIZING', 'SUCCESS', 'FAILED'] },
                },
                _count: { aiStatus: true },
              }),
            ]);

            totalUsers += userCount;
            totalCompletedConsultations += completedCount;

            for (const row of aiCounts) {
              const count = row._count.aiStatus;
              if (row.aiStatus === 'SUMMARIZING') aiInProgress += count;
              else if (row.aiStatus === 'SUCCESS') aiSuccess += count;
              else if (row.aiStatus === 'FAILED') aiFailed += count;
            }
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
                aiError: true,
                createdAt: true,
                updatedAt: true,
              },
              orderBy: { updatedAt: 'desc' },
              take: limit,
            });

            for (const note of notes) {
              allJobs.push({ ...note, tenantName });
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
}
