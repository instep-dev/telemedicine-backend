import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import type { TenantContext } from '../tenant/tenant.interface';
import { GetAiResultsQueryDto } from './dto/ai-results.dto';
import { UserRole } from '@prisma/client';

@Injectable()
export class AiResultsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeLimit(limit?: string): number {
    const parsed = Number(limit ?? 10);

    if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
      throw new BadRequestException('limit harus berupa angka');
    }

    if (parsed < 1) return 1;
    if (parsed > 100) return 100;

    return Math.floor(parsed);
  }

  private normalizeSort(sort?: string): 'newest' | 'oldest' {
    if (sort === 'oldest') return 'oldest';
    return 'newest';
  }

  private buildStatusBucketFilter(bucket?: string): any {
    if (bucket === 'success') {
      // Finalized records are always success, regardless of aiStatus
      return { OR: [{ aiStatus: 'SUCCESS' }, { isFinalized: true }] };
    }
    if (bucket === 'failed') {
      // Only unfinalized records with a failure status
      return {
        isFinalized: false,
        OR: [{ aiStatus: 'FAILED' }, { aiStatus: { contains: 'ERROR', mode: 'insensitive' } }],
      };
    }
    if (bucket === 'in-progress') {
      // Not finalized, not success, not failed
      return {
        isFinalized: false,
        OR: [
          { aiStatus: null },
          {
            AND: [
              { NOT: { aiStatus: 'SUCCESS' } },
              { NOT: { aiStatus: 'FAILED' } },
              { NOT: { aiStatus: { contains: 'ERROR', mode: 'insensitive' } } },
            ],
          },
        ],
      };
    }
    return {};
  }

  async findAllByDoctor(doctorId: string, query: GetAiResultsQueryDto, tenant: TenantContext) {
    const limit = this.normalizeLimit(query.limit);
    const cursor = query.cursor?.trim() || undefined;
    const search = query.search?.trim() || undefined;
    const sort = this.normalizeSort(query.sort);
    const bucketFilter = this.buildStatusBucketFilter(query.statusBucket);

    const orderBy =
      sort === 'oldest'
        ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
        : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    const baseWhere: any = {
      doctorId,
      consultationSession: { sessionStatus: 'COMPLETED' },
    };

    // Use AND to avoid OR collision when both bucket filter and search are active
    const andConditions: any[] = [];
    if (Object.keys(bucketFilter).length > 0) andConditions.push(bucketFilter);
    if (search) {
      andConditions.push({
        OR: [
          { summary: { contains: search, mode: 'insensitive' } },
          { subjective: { contains: search, mode: 'insensitive' } },
          { objective: { contains: search, mode: 'insensitive' } },
          { assessment: { contains: search, mode: 'insensitive' } },
          { plan: { contains: search, mode: 'insensitive' } },
          { transcriptRaw: { contains: search, mode: 'insensitive' } },
          { aiStatus: { contains: search, mode: 'insensitive' } },
          { consultationSession: { sessionId: { contains: search, mode: 'insensitive' } } },
          { consultationSession: { roomName: { contains: search, mode: 'insensitive' } } },
          { consultationSession: { patientIdentity: { contains: search, mode: 'insensitive' } } },
          { consultationSession: { patientName: { contains: search, mode: 'insensitive' } } },
          { consultationSession: { doctor: { name: { contains: search, mode: 'insensitive' } } } },
        ],
      });
    }
    const whereClause: any = andConditions.length > 0 ? { ...baseWhere, AND: andConditions } : baseWhere;

    if (cursor) {
      const cursorRow = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        return tx.consultationNote.findFirst({ where: { id: cursor, doctorId }, select: { id: true } });
      });

      if (!cursorRow) throw new NotFoundException('Cursor tidak ditemukan untuk doctor ini');
    }

    const { rows, totals } = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const [data, successCount, failedCount, inProgressCount, totalCount] = await Promise.all([
        tx.consultationNote.findMany({
          where: whereClause,
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy,
          include: {
            consultationSession: {
              select: {
                sessionId: true,
                sessionStatus: true,
                roomName: true,
                patientName: true,
                patientIdentity: true,
                startedAt: true,
                endedAt: true,
                durationSec: true,
                twilioRoomSid: true,
                doctorIdentity: true,
                consultationMode: true,
                sessionType: true,
                recordingStatus: true,
                compositionStatus: true,
                mediaUrl: true,
                mediaFormat: true,
                errorMessage: true,
                createdAt: true,
                updatedAt: true,
                doctor: { select: { id: true, name: true } },
              },
            },
          },
        }),
        tx.consultationNote.count({ where: { ...baseWhere, ...this.buildStatusBucketFilter('success') } }),
        tx.consultationNote.count({ where: { ...baseWhere, ...this.buildStatusBucketFilter('failed') } }),
        tx.consultationNote.count({ where: { ...baseWhere, ...this.buildStatusBucketFilter('in-progress') } }),
        tx.consultationNote.count({ where: baseWhere }),
      ]);
      return {
        rows: data,
        totals: { success: successCount, failed: failedCount, inProgress: inProgressCount, total: totalCount },
      };
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      data: items.map((item) => {
        const patientName = item.consultationSession.patientName ?? null;
        return {
          id: item.id,
          consultationId: item.consultationSessionId,
          sessionId: item.consultationSessionId,
          doctorId: item.doctorId,
          doctorName: item.consultationSession.doctor?.name ?? null,
          roomName: item.consultationSession.roomName,
          patientIdentity: item.consultationSession.patientIdentity,
          patientName,
          consultationStatus: item.consultationSession.sessionStatus,
          consultationMode: item.consultationSession.consultationMode,
          sessionType: item.consultationSession.sessionType,
          consultationStartedAt: item.consultationSession.startedAt,
          consultationEndedAt: item.consultationSession.endedAt,
          summary: item.summary,
          subjective: item.subjective,
          objective: item.objective,
          assessment: item.assessment,
          plan: item.plan,
          transcriptRaw: item.transcriptRaw,
          aiStatus: item.aiStatus,
          aiError: item.aiError,
          isFinalized: item.isFinalized,
          transcribedAt: item.transcribedAt,
          summarizedAt: item.summarizedAt,
          aiModel: item.aiModel,
          callSession: {
            id: item.consultationSession.sessionId,
            durationSec: item.consultationSession.durationSec,
            status: item.consultationSession.sessionStatus,
            roomSid: item.consultationSession.twilioRoomSid,
            roomName: item.consultationSession.roomName,
            patientIdentity: item.consultationSession.patientIdentity,
            patientName: item.consultationSession.patientName ?? null,
            createdAt: item.consultationSession.createdAt,
          },
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        };
      }),
      pagination: { limit, nextCursor, hasMore, sort, search: search ?? null },
      totals,
    };
  }

  async findAllByNurse(nurseId: string, query: GetAiResultsQueryDto, tenant: TenantContext) {
    const limit = this.normalizeLimit(query.limit);
    const cursor = query.cursor?.trim() || undefined;
    const search = query.search?.trim() || undefined;
    const sort = this.normalizeSort(query.sort);
    const bucketFilter = this.buildStatusBucketFilter(query.statusBucket);

    const orderBy =
      sort === 'oldest'
        ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
        : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    const baseWhere: any = { consultationSession: { nurseId, sessionStatus: 'COMPLETED' } };

    const andConditions: any[] = [];
    if (Object.keys(bucketFilter).length > 0) andConditions.push(bucketFilter);
    if (search) {
      andConditions.push({
        OR: [
          { summary: { contains: search, mode: 'insensitive' } },
          { subjective: { contains: search, mode: 'insensitive' } },
          { objective: { contains: search, mode: 'insensitive' } },
          { assessment: { contains: search, mode: 'insensitive' } },
          { plan: { contains: search, mode: 'insensitive' } },
          { transcriptRaw: { contains: search, mode: 'insensitive' } },
          { aiStatus: { contains: search, mode: 'insensitive' } },
          { consultationSession: { sessionId: { contains: search, mode: 'insensitive' } } },
          { consultationSession: { patientName: { contains: search, mode: 'insensitive' } } },
          { consultationSession: { doctor: { name: { contains: search, mode: 'insensitive' } } } },
        ],
      });
    }
    const whereClause: any = andConditions.length > 0 ? { ...baseWhere, AND: andConditions } : baseWhere;

    if (cursor) {
      const cursorRow = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        return tx.consultationNote.findFirst({
          where: { id: cursor, consultationSession: { nurseId } },
          select: { id: true },
        });
      });
      if (!cursorRow) throw new NotFoundException('Cursor tidak ditemukan untuk nurse ini');
    }

    const { rows, totals } = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const [data, successCount, failedCount, inProgressCount, totalCount] = await Promise.all([
        tx.consultationNote.findMany({
          where: whereClause,
          take: limit + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy,
          include: {
            consultationSession: {
              select: {
                sessionId: true,
                sessionStatus: true,
                roomName: true,
                patientName: true,
                patientIdentity: true,
                startedAt: true,
                endedAt: true,
                durationSec: true,
                twilioRoomSid: true,
                doctorIdentity: true,
                consultationMode: true,
                sessionType: true,
                recordingStatus: true,
                compositionStatus: true,
                mediaUrl: true,
                mediaFormat: true,
                errorMessage: true,
                createdAt: true,
                updatedAt: true,
                doctor: { select: { id: true, name: true } },
              },
            },
          },
        }),
        tx.consultationNote.count({ where: { ...baseWhere, ...this.buildStatusBucketFilter('success') } }),
        tx.consultationNote.count({ where: { ...baseWhere, ...this.buildStatusBucketFilter('failed') } }),
        tx.consultationNote.count({ where: { ...baseWhere, ...this.buildStatusBucketFilter('in-progress') } }),
        tx.consultationNote.count({ where: baseWhere }),
      ]);
      return {
        rows: data,
        totals: { success: successCount, failed: failedCount, inProgress: inProgressCount, total: totalCount },
      };
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      data: items.map((item) => ({
        id: item.id,
        consultationId: item.consultationSessionId,
        sessionId: item.consultationSessionId,
        doctorId: item.doctorId,
        doctorName: item.consultationSession.doctor?.name ?? null,
        roomName: item.consultationSession.roomName,
        patientIdentity: item.consultationSession.patientIdentity,
        patientName: item.consultationSession.patientName ?? null,
        consultationStatus: item.consultationSession.sessionStatus,
        consultationMode: item.consultationSession.consultationMode,
        sessionType: item.consultationSession.sessionType,
        consultationStartedAt: item.consultationSession.startedAt,
        consultationEndedAt: item.consultationSession.endedAt,
        summary: item.summary,
        subjective: item.subjective,
        objective: item.objective,
        assessment: item.assessment,
        plan: item.plan,
        transcriptRaw: item.transcriptRaw,
        aiStatus: item.aiStatus,
        aiError: item.aiError,
        isFinalized: item.isFinalized,
        transcribedAt: item.transcribedAt,
        summarizedAt: item.summarizedAt,
        aiModel: item.aiModel,
        callSession: {
          id: item.consultationSession.sessionId,
          durationSec: item.consultationSession.durationSec,
          status: item.consultationSession.sessionStatus,
          roomSid: item.consultationSession.twilioRoomSid,
          roomName: item.consultationSession.roomName,
          patientIdentity: item.consultationSession.patientIdentity,
          patientName: item.consultationSession.patientName ?? null,
          createdAt: item.consultationSession.createdAt,
        },
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      pagination: { limit, nextCursor, hasMore, sort, search: search ?? null },
      totals,
    };
  }

  async findAllByPatient(patientId: string, query: GetAiResultsQueryDto, tenant: TenantContext) {
    const limit = this.normalizeLimit(query.limit);
    const cursor = query.cursor?.trim() || undefined;
    const search = query.search?.trim() || undefined;
    const sort = this.normalizeSort(query.sort);
    const bucketFilter = this.buildStatusBucketFilter(query.statusBucket);

    const orderBy =
      sort === 'oldest'
        ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
        : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    const whereClause: any = {
      consultationSession: { patientId, sessionStatus: 'COMPLETED' },
      ...bucketFilter,
      ...(search
        ? {
            OR: [
              { summary: { contains: search, mode: 'insensitive' } },
              { aiStatus: { contains: search, mode: 'insensitive' } },
              { consultationSession: { roomName: { contains: search, mode: 'insensitive' } } },
              { consultationSession: { doctor: { name: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };

    // Validate cursor belongs to this patient — prevents cursor poisoning across patients
    if (cursor) {
      const cursorRow = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        return tx.consultationNote.findFirst({
          where: { id: cursor, consultationSession: { patientId } },
          select: { id: true },
        });
      });
      if (!cursorRow) throw new NotFoundException('Cursor tidak ditemukan');
    }

    const rows = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationNote.findMany({
        where: whereClause,
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy,
        include: {
          consultationSession: {
            select: {
              sessionId: true,
              sessionStatus: true,
              roomName: true,
              patientName: true,
              patientIdentity: true,
              startedAt: true,
              endedAt: true,
              durationSec: true,
              consultationMode: true,
              sessionType: true,
              createdAt: true,
              updatedAt: true,
              doctor: { select: { id: true, name: true } },
            },
          },
        },
      });
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      data: items.map((item) => ({
        id: item.id,
        consultationId: item.consultationSessionId,
        sessionId: item.consultationSessionId,
        doctorId: item.doctorId,
        doctorName: item.consultationSession.doctor?.name ?? null,
        roomName: item.consultationSession.roomName,
        patientIdentity: item.consultationSession.patientIdentity,
        patientName: item.consultationSession.patientName ?? null,
        consultationStatus: item.consultationSession.sessionStatus,
        consultationMode: item.consultationSession.consultationMode,
        sessionType: item.consultationSession.sessionType,
        consultationStartedAt: item.consultationSession.startedAt,
        consultationEndedAt: item.consultationSession.endedAt,
        summary: item.summary,
        subjective: item.subjective,
        objective: item.objective,
        assessment: item.assessment,
        plan: item.plan,
        transcriptRaw: null, // never expose raw transcript to patients
        aiStatus: item.aiStatus,
        aiError: item.aiError,
        transcribedAt: item.transcribedAt,
        summarizedAt: item.summarizedAt,
        aiModel: item.aiModel,
        callSession: {
          id: item.consultationSession.sessionId,
          durationSec: item.consultationSession.durationSec,
          status: item.consultationSession.sessionStatus,
          roomSid: null,
          roomName: item.consultationSession.roomName,
          patientIdentity: item.consultationSession.patientIdentity,
          patientName: item.consultationSession.patientName ?? null,
          createdAt: item.consultationSession.createdAt,
        },
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
      pagination: { limit, nextCursor, hasMore, sort, search: search ?? null },
    };
  }

  async findByIdForNurse(nurseId: string, id: string, tenant: TenantContext) {
    const note = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const found = await tx.consultationNote.findFirst({
        where: { id, consultationSession: { nurseId } },
        include: {
          consultationSession: {
            select: {
              sessionId: true,
              sessionStatus: true,
              consultationMode: true,
              sessionType: true,
              roomName: true,
              patientName: true,
              patientIdentity: true,
              startedAt: true,
              endedAt: true,
              durationSec: true,
              twilioRoomSid: true,
              doctorIdentity: true,
              recordingStatus: true,
              compositionStatus: true,
              mediaUrl: true,
              mediaFormat: true,
              errorMessage: true,
              createdAt: true,
              updatedAt: true,
              doctor: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (found) {
        await tx.consultationSessionAudit.create({
          data: {
            tenantId: tenant.id,
            consultationSessionId: found.consultationSessionId,
            actorUserId: nurseId,
            actorRole: UserRole.NURSE,
            action: 'NURSE_VIEW_SUMMARY',
            previousStatus: found.consultationSession.sessionStatus,
            newStatus: found.consultationSession.sessionStatus,
          },
        });
      }

      return found;
    });

    if (!note) throw new NotFoundException('AI summary tidak ditemukan');

    return {
      id: note.id,
      consultationId: note.consultationSessionId,
      sessionId: note.consultationSessionId,
      doctorId: note.doctorId,
      doctorName: note.consultationSession.doctor?.name ?? null,
      roomName: note.consultationSession.roomName,
      patientIdentity: note.consultationSession.patientIdentity,
      patientName: note.consultationSession.patientName ?? null,
      consultationStatus: note.consultationSession.sessionStatus,
      consultationMode: note.consultationSession.consultationMode,
      sessionType: note.consultationSession.sessionType,
      consultationStartedAt: note.consultationSession.startedAt,
      consultationEndedAt: note.consultationSession.endedAt,
      summary: note.summary,
      subjective: note.subjective,
      objective: note.objective,
      assessment: note.assessment,
      plan: note.plan,
      transcriptRaw: note.transcriptRaw,
      aiStatus: note.aiStatus,
      aiError: note.aiError,
      transcribedAt: note.transcribedAt,
      summarizedAt: note.summarizedAt,
      aiModel: note.aiModel,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      callSession: {
        id: note.consultationSession.sessionId,
        status: note.consultationSession.sessionStatus,
        roomSid: note.consultationSession.twilioRoomSid,
        roomName: note.consultationSession.roomName,
        doctorIdentity: note.consultationSession.doctorIdentity,
        patientIdentity: note.consultationSession.patientIdentity,
        startedAt: note.consultationSession.startedAt,
        endedAt: note.consultationSession.endedAt,
        recordingStatus: note.consultationSession.recordingStatus,
        compositionStatus: note.consultationSession.compositionStatus,
        mediaUrl: note.consultationSession.mediaUrl,
        mediaFormat: note.consultationSession.mediaFormat,
        durationSec: note.consultationSession.durationSec,
        errorMessage: note.consultationSession.errorMessage,
        createdAt: note.consultationSession.createdAt,
        updatedAt: note.consultationSession.updatedAt,
      },
    };
  }

  async findById(doctorId: string, id: string, tenant: TenantContext) {
    const note = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const found = await tx.consultationNote.findFirst({
        where: { id, doctorId },
        include: {
          consultationSession: {
            select: {
              sessionId: true,
              sessionStatus: true,
              consultationMode: true,
              sessionType: true,
              roomName: true,
              patientName: true,
              patientIdentity: true,
              startedAt: true,
              endedAt: true,
              durationSec: true,
              twilioRoomSid: true,
              doctorIdentity: true,
              recordingStatus: true,
              compositionStatus: true,
              mediaUrl: true,
              mediaFormat: true,
              errorMessage: true,
              createdAt: true,
              updatedAt: true,
              doctor: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (found) {
        await tx.consultationSessionAudit.create({
          data: {
            tenantId: tenant.id,
            consultationSessionId: found.consultationSessionId,
            actorUserId: doctorId,
            actorRole: UserRole.DOCTOR,
            action: 'DOCTOR_VIEW_SUMMARY',
            previousStatus: found.consultationSession.sessionStatus,
            newStatus: found.consultationSession.sessionStatus,
          },
        });
      }

      return found;
    });

    if (!note) throw new NotFoundException('AI summary tidak ditemukan');

    return {
      id: note.id,
      consultationId: note.consultationSessionId,
      sessionId: note.consultationSessionId,
      doctorId: note.doctorId,
      doctorName: note.consultationSession.doctor?.name ?? null,
      roomName: note.consultationSession.roomName,
      patientIdentity: note.consultationSession.patientIdentity,
      patientName: note.consultationSession.patientName ?? null,
      consultationStatus: note.consultationSession.sessionStatus,
      consultationMode: note.consultationSession.consultationMode,
      sessionType: note.consultationSession.sessionType,
      consultationStartedAt: note.consultationSession.startedAt,
      consultationEndedAt: note.consultationSession.endedAt,
      summary: note.summary,
      subjective: note.subjective,
      objective: note.objective,
      assessment: note.assessment,
      plan: note.plan,
      transcriptRaw: note.transcriptRaw,
      aiStatus: note.aiStatus,
      aiError: note.aiError,
      transcribedAt: note.transcribedAt,
      summarizedAt: note.summarizedAt,
      aiModel: note.aiModel,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      callSession: {
        id: note.consultationSession.sessionId,
        status: note.consultationSession.sessionStatus,
        roomSid: note.consultationSession.twilioRoomSid,
        roomName: note.consultationSession.roomName,
        doctorIdentity: note.consultationSession.doctorIdentity,
        patientIdentity: note.consultationSession.patientIdentity,
        startedAt: note.consultationSession.startedAt,
        endedAt: note.consultationSession.endedAt,
        recordingStatus: note.consultationSession.recordingStatus,
        compositionStatus: note.consultationSession.compositionStatus,
        mediaUrl: note.consultationSession.mediaUrl,
        mediaFormat: note.consultationSession.mediaFormat,
        durationSec: note.consultationSession.durationSec,
        errorMessage: note.consultationSession.errorMessage,
        createdAt: note.consultationSession.createdAt,
        updatedAt: note.consultationSession.updatedAt,
      },
    };
  }
}
