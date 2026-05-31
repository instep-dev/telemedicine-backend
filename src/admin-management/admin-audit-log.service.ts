import { Injectable } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import type { AuditLogQueryDto } from './dto/admin-audit-log.dto';

const PAGE_SIZE = 30;

@Injectable()
export class AdminAuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, schemaName: string, query: AuditLogQueryDto) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const cursor = query.cursor ?? null;

      // AuditLog entries
      const auditLogs = await tx.auditLog.findMany({
        where: {
          tenantId,
          ...(query.action && { action: { contains: query.action, mode: 'insensitive' } }),
        },
        take: PAGE_SIZE + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          actorId: true,
          actorName: true,
          actorRole: true,
          action: true,
          targetType: true,
          targetId: true,
          metadata: true,
          createdAt: true,
        },
      });

      const hasMore = auditLogs.length > PAGE_SIZE;
      const data = hasMore ? auditLogs.slice(0, PAGE_SIZE) : auditLogs;

      return {
        data: data.map((l) => ({ ...l, source: 'AUDIT_LOG' })),
        nextCursor: hasMore ? data[data.length - 1].id : null,
        hasMore,
      };
    });
  }

  async findOne(tenantId: string, schemaName: string, id: string) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const log = await tx.auditLog.findFirst({
        where: { id, tenantId },
      });
      return log;
    });
  }

  async findSessionAudits(tenantId: string, schemaName: string, cursor?: string) {
    return this.prisma.withTenantSchema(schemaName, async (tx) => {
      const audits = await tx.consultationSessionAudit.findMany({
        where: { tenantId },
        take: PAGE_SIZE + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          actorUserId: true,
          actorRole: true,
          action: true,
          previousStatus: true,
          newStatus: true,
          metadata: true,
          createdAt: true,
          consultationSessionId: true,
          actorUser: { select: { name: true } },
        },
      });

      const hasMore = audits.length > PAGE_SIZE;
      const data = hasMore ? audits.slice(0, PAGE_SIZE) : audits;

      return {
        data: data.map((a) => ({
          id: a.id,
          actorId: a.actorUserId,
          actorName: a.actorUser?.name ?? null,
          actorRole: a.actorRole,
          action: a.action,
          targetType: 'SESSION',
          targetId: a.consultationSessionId,
          metadata: { previousStatus: a.previousStatus, newStatus: a.newStatus, ...(a.metadata as any) },
          createdAt: a.createdAt,
          source: 'SESSION_AUDIT',
        })),
        nextCursor: hasMore ? data[data.length - 1].id : null,
        hasMore,
      };
    });
  }
}
