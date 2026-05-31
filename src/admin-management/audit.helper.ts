import type { PrismaService } from 'prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

export interface AuditLogEntry {
  tenantId: string;
  actorId?: string;
  actorName?: string;
  actorRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(
  prisma: PrismaService,
  schemaName: string,
  entry: AuditLogEntry,
) {
  try {
    await prisma.withTenantSchema(schemaName, async (tx) => {
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: entry.tenantId,
          actorId: entry.actorId ?? null,
          actorName: entry.actorName ?? null,
          actorRole: entry.actorRole ?? null,
          action: entry.action,
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          metadata: entry.metadata !== undefined
            ? (entry.metadata as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        },
      });
    });
  } catch {
    // audit log failure should never break the main flow
  }
}
