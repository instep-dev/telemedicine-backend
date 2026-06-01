import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConsultationMode,
  Prisma,
  SessionStatus,
  SessionType,
  UserRole,
} from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import type { TenantContext } from '../tenant/tenant.interface';
import {
  CreateConsultationSessionDto,
  ListConsultationSessionsQueryDto,
  RescheduleConsultationSessionDto,
} from './dto/consultations.dto';

const sessionWithProfilesInclude =
  Prisma.validator<Prisma.ConsultationSessionInclude>()({
    doctor: {
      include: {
        doctorProfile: { select: { fullName: true, license: true } },
      },
    },
    patient: {
      include: {
        patientProfile: { select: { fullName: true, mrn: true } },
      },
    },
    nurse: {
      include: {
        nurseProfile: { select: { fullName: true, nurseId: true } },
      },
    },
    createdByAdmin: {
      include: {
        adminProfile: { select: { fullName: true } },
      },
    },
    consultationNote: { select: { id: true, aiStatus: true, subjective: true } },
  });

type SessionWithProfiles = Prisma.ConsultationSessionGetPayload<{
  include: typeof sessionWithProfilesInclude;
}>;

@Injectable()
export class ConsultationsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Date helpers ─────────────────────────────────────────────────────────

  private toJakartaDate(date: string, time: string): Date {
    return new Date(`${date}T${time}:00+07:00`);
  }

  private toJakartaDateOnly(date: string): Date {
    return new Date(`${date}T00:00:00+07:00`);
  }

  private toJakartaDateKey(date: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(date)
      .split('-');
    return `${parts[0]}${parts[1]}${parts[2]}`;
  }

  private nowInJakartaDateString(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private randomSuffix(length = 4): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  // ─── Validation helpers ────────────────────────────────────────────────────

  private assertScheduleWindow(start: Date, end: Date) {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Tanggal atau jam schedule tidak valid');
    }
    if (end.getTime() <= start.getTime()) {
      throw new BadRequestException('scheduledEndTime harus lebih besar dari scheduledStartTime');
    }
  }

  private assertScheduleInFuture(start: Date) {
    const nowPlus3Min = new Date(Date.now() + 3 * 60 * 1000);
    if (start.getTime() < nowPlus3Min.getTime()) {
      throw new BadRequestException('Jadwal konsultasi harus minimal 3 menit dari sekarang (WIB)');
    }
  }

  private hasOverlap(aStart: Date, aEnd: Date | null, bStart: Date, bEnd: Date | null): boolean {
    const aEndMs = aEnd ? aEnd.getTime() : Number.POSITIVE_INFINITY;
    const bEndMs = bEnd ? bEnd.getTime() : Number.POSITIVE_INFINITY;
    return aStart.getTime() < bEndMs && bStart.getTime() < aEndMs;
  }

  private assertRole(actual: UserRole, expected: UserRole) {
    if (actual !== expected) throw new ForbiddenException('Role tidak diizinkan');
  }

  // ─── ID / room name generators (call inside withTenantSchema) ─────────────

  private async generateUniqueSessionId(
    tx: Prisma.TransactionClient,
    seedDate: Date,
  ): Promise<string> {
    const datePart = this.toJakartaDateKey(seedDate);
    for (let i = 0; i < 20; i++) {
      const candidate = `CS-${datePart}-${this.randomSuffix(4)}`;
      const exists = await tx.consultationSession.findUnique({
        where: { sessionId: candidate },
        select: { sessionId: true },
      });
      if (!exists) return candidate;
    }
    throw new Error('Gagal generate session id unik');
  }

  private async generateUniqueRoomName(
    tx: Prisma.TransactionClient,
    sessionId: string,
  ): Promise<string> {
    const base = `room_${sessionId.toLowerCase()}`;
    // roomName is now @@unique([roomName, tenantId]) — use findFirst within tenant schema
    const exists = await tx.consultationSession.findFirst({
      where: { roomName: base },
      select: { sessionId: true },
    });
    if (!exists) return base;

    for (let i = 0; i < 10; i++) {
      const candidate = `${base}_${this.randomSuffix(4).toLowerCase()}`;
      const roomExists = await tx.consultationSession.findFirst({
        where: { roomName: candidate },
        select: { sessionId: true },
      });
      if (!roomExists) return candidate;
    }
    throw new Error('Gagal generate room name unik');
  }

  private normalizeSort(sort?: 'newest' | 'oldest') {
    if (sort === 'oldest') {
      return [{ scheduledStartTime: 'asc' as const }, { createdAt: 'asc' as const }];
    }
    return [{ scheduledStartTime: 'desc' as const }, { createdAt: 'desc' as const }];
  }

  private buildSearchClause(search?: string) {
    const keyword = search?.trim();
    if (!keyword) return {};
    return {
      OR: [
        { sessionId: { contains: keyword, mode: 'insensitive' as const } },
        { patientName: { contains: keyword, mode: 'insensitive' as const } },
        { roomName: { contains: keyword, mode: 'insensitive' as const } },
        { doctor: { name: { contains: keyword, mode: 'insensitive' as const } } },
        { patient: { name: { contains: keyword, mode: 'insensitive' as const } } },
      ],
    };
  }

  // ─── Session mappers ───────────────────────────────────────────────────────

  private getPatientDisplayName(s: SessionWithProfiles): string | null {
    return s.patientName ?? s.patient.patientProfile?.fullName ?? s.patient.name ?? null;
  }

  private getDoctorDisplayName(s: SessionWithProfiles): string | null {
    return s.doctor.doctorProfile?.fullName ?? s.doctor.name ?? null;
  }

  private getNurseDisplayName(s: SessionWithProfiles): string | null {
    return s.nurse?.nurseProfile?.fullName ?? s.nurse?.name ?? null;
  }

  private canDoctorJoinNow(s: SessionWithProfiles, now = new Date()): boolean {
    if (s.sessionStatus === 'COMPLETED' || s.sessionStatus === 'FAILED') return false;
    if (s.sessionType === 'INSTANT') return true;
    if (!s.scheduledEndTime) return false;
    return now.getTime() >= s.scheduledStartTime.getTime() && now.getTime() < s.scheduledEndTime.getTime();
  }

  private canPatientJoinNow(s: SessionWithProfiles, now = new Date()): boolean {
    if (s.sessionStatus === 'COMPLETED' || s.sessionStatus === 'FAILED') return false;
    if (s.sessionType === 'INSTANT') return true;
    if (!s.scheduledEndTime) return false;
    return now.getTime() >= s.scheduledStartTime.getTime() && now.getTime() < s.scheduledEndTime.getTime();
  }

  private canNurseJoinNow(s: SessionWithProfiles, now = new Date()): boolean {
    if (!s.nurseId) return false;
    if (s.sessionStatus === 'COMPLETED' || s.sessionStatus === 'FAILED') return false;
    if (s.sessionType === 'INSTANT') return true;
    if (!s.scheduledEndTime) return false;
    return now.getTime() >= s.scheduledStartTime.getTime() && now.getTime() < s.scheduledEndTime.getTime();
  }

  private mapSession(s: SessionWithProfiles) {
    return {
      sessionId: s.sessionId,
      sessionType: s.sessionType,
      consultationMode: s.consultationMode,
      sessionStatus: s.sessionStatus,
      scheduledDate: s.scheduledDate,
      scheduledStartTime: s.scheduledStartTime,
      scheduledEndTime: s.scheduledEndTime,
      durationMinutes: s.durationMinutes,
      doctorId: s.doctorId,
      doctorName: this.getDoctorDisplayName(s),
      patientId: s.patientId,
      patientName: this.getPatientDisplayName(s),
      patientMrn: s.patient.patientProfile?.mrn ?? null,
      nurseId: s.nurseId ?? null,
      nurseName: this.getNurseDisplayName(s),
      createdBy: s.createdBy,
      createdByName: s.createdByAdmin.adminProfile?.fullName ?? s.createdByAdmin.name ?? null,
      doctorJoinedAt: s.doctorJoinedAt,
      patientJoinedAt: s.patientJoinedAt,
      nurseJoinedAt: s.nurseJoinedAt,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      roomName: s.roomName,
      canDoctorJoin: this.canDoctorJoinNow(s),
      canPatientJoin: this.canPatientJoinNow(s),
      canNurseJoin: this.canNurseJoinNow(s),
      doctorJoinState:
        s.sessionStatus === 'COMPLETED' || s.sessionStatus === 'FAILED'
          ? s.doctorJoinedAt ? 'JOINED' : 'DISABLED'
          : this.canDoctorJoinNow(s) ? 'JOIN' : 'DISABLED',
      patientJoinState:
        s.sessionStatus === 'COMPLETED' || s.sessionStatus === 'FAILED'
          ? s.patientJoinedAt ? 'JOINED' : 'DISABLED'
          : this.canPatientJoinNow(s) ? 'JOIN' : 'DISABLED',
      nurseJoinState: !s.nurseId
        ? 'NONE'
        : s.sessionStatus === 'COMPLETED' || s.sessionStatus === 'FAILED'
          ? s.nurseJoinedAt ? 'JOINED' : 'DISABLED'
          : this.canNurseJoinNow(s) ? 'JOIN' : 'DISABLED',
      chiefComplaint: s.consultationNote?.subjective ?? null,
      consultationNote: s.consultationNote
        ? { id: s.consultationNote.id, aiStatus: s.consultationNote.aiStatus }
        : null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }

  // ─── Audit (called inside withTenantSchema tx) ─────────────────────────────

  async createAudit(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: {
      consultationSessionId: string;
      action: string;
      actorUserId?: string | null;
      actorRole?: UserRole | null;
      previousStatus?: SessionStatus | null;
      newStatus?: SessionStatus | null;
      metadata?: Prisma.InputJsonObject | null;
    },
  ) {
    const metadataValue =
      params.metadata === null
        ? Prisma.JsonNull
        : params.metadata === undefined
          ? undefined
          : params.metadata;

    await tx.consultationSessionAudit.create({
      data: {
        tenantId,
        consultationSessionId: params.consultationSessionId,
        action: params.action,
        actorUserId: params.actorUserId ?? null,
        actorRole: params.actorRole ?? null,
        previousStatus: params.previousStatus ?? null,
        newStatus: params.newStatus ?? null,
        metadata: metadataValue,
      },
    });
  }

  // Called from external services (twilio, ai, etc.) without an open tx
  async createAuditForTenant(
    tenant: TenantContext,
    params: {
      consultationSessionId: string;
      action: string;
      actorUserId?: string | null;
      actorRole?: UserRole | null;
      previousStatus?: SessionStatus | null;
      newStatus?: SessionStatus | null;
      metadata?: Prisma.InputJsonObject | null;
    },
  ) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return this.createAudit(tx, tenant.id, params);
    });
  }

  // ─── Public methods ────────────────────────────────────────────────────────

  async createByAdmin(
    adminUserId: string,
    dto: CreateConsultationSessionDto,
    tenant: TenantContext,
  ) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const [admin, doctor, patient] = await Promise.all([
        tx.user.findUnique({ where: { id: adminUserId }, select: { id: true, role: true, isActive: true, tenantId: true } }),
        tx.user.findUnique({ where: { id: dto.doctorId }, select: { id: true, role: true, isActive: true, tenantId: true } }),
        tx.user.findUnique({ where: { id: dto.patientId }, select: { id: true, role: true, isActive: true, tenantId: true } }),
      ]);

      if (!admin || !admin.isActive) throw new ForbiddenException('Admin tidak valid');
      this.assertRole(admin.role, UserRole.ADMIN);

      if (!doctor || !doctor.isActive) throw new BadRequestException('Dokter tidak valid');
      this.assertRole(doctor.role, UserRole.DOCTOR);

      if (!patient || !patient.isActive) throw new BadRequestException('Patient tidak valid');
      this.assertRole(patient.role, UserRole.PATIENT);

      // Layer 5: cross-tenant entity validation
      if (admin.tenantId !== tenant.id) throw new ForbiddenException('Admin bukan milik tenant ini');
      if (doctor.tenantId !== tenant.id) throw new ForbiddenException('Dokter bukan milik tenant ini');
      if (patient.tenantId !== tenant.id) throw new ForbiddenException('Patient bukan milik tenant ini');

      let nurseUserId: string | null = null;
      if (dto.nurseId) {
        const nurse = await tx.user.findUnique({
          where: { id: dto.nurseId },
          select: { id: true, role: true, isActive: true, tenantId: true },
        });
        if (!nurse || !nurse.isActive) throw new BadRequestException('Nurse tidak valid');
        this.assertRole(nurse.role, UserRole.NURSE);
        if (nurse.tenantId !== tenant.id) throw new ForbiddenException('Nurse bukan milik tenant ini');
        nurseUserId = nurse.id;
      }

      const doctorProfile = await tx.doctorProfile.findUnique({
        where: { userId: doctor.id },
        select: { license: true },
      });
      if (!doctorProfile?.license?.trim()) {
        throw new BadRequestException('Dokter tanpa license tidak bisa dijadwalkan konsultasi');
      }

      let scheduledDate: Date;
      let scheduledStartTime: Date;
      let scheduledEndTime: Date | null;

      if (dto.sessionType === SessionType.SCHEDULED) {
        if (!dto.scheduledDate || !dto.scheduledStartTime || !dto.scheduledEndTime) {
          throw new BadRequestException('Untuk SCHEDULED, scheduledDate, scheduledStartTime, scheduledEndTime wajib diisi');
        }
        scheduledDate = this.toJakartaDateOnly(dto.scheduledDate);
        scheduledStartTime = this.toJakartaDate(dto.scheduledDate, dto.scheduledStartTime);
        scheduledEndTime = this.toJakartaDate(dto.scheduledDate, dto.scheduledEndTime);
        this.assertScheduleWindow(scheduledStartTime, scheduledEndTime);
        this.assertScheduleInFuture(scheduledStartTime);
      } else {
        const now = new Date();
        scheduledDate = this.toJakartaDateOnly(this.nowInJakartaDateString());
        scheduledStartTime = now;
        scheduledEndTime = null;
      }

      // Conflict check within tenant — only sessions whose window hasn't fully passed
      const activeSessions = await tx.consultationSession.findMany({
        where: {
          OR: [{ doctorId: doctor.id }, { patientId: patient.id }],
          sessionStatus: { in: ['CREATED', 'IN_CALL'] },
          scheduledEndTime: { gt: new Date() },
        },
        select: { sessionId: true, doctorId: true, patientId: true, scheduledStartTime: true, scheduledEndTime: true },
      });

      for (const item of activeSessions) {
        if (!this.hasOverlap(item.scheduledStartTime, item.scheduledEndTime, scheduledStartTime, scheduledEndTime)) continue;
        if (item.doctorId === doctor.id) throw new BadRequestException(`Dokter sudah punya jadwal bentrok dengan session ${item.sessionId}`);
        if (item.patientId === patient.id) throw new BadRequestException(`Patient sudah punya jadwal bentrok dengan session ${item.sessionId}`);
      }

      const sessionId = await this.generateUniqueSessionId(tx, scheduledDate);
      const roomName = await this.generateUniqueRoomName(tx, sessionId);

      const created = await tx.consultationSession.create({
        data: {
          sessionId,
          tenantId: tenant.id,
          doctorId: doctor.id,
          patientId: patient.id,
          nurseId: nurseUserId,
          sessionType: dto.sessionType,
          consultationMode: dto.consultationMode,
          serviceType: dto.serviceType ?? 'TELEMEDICINE',
          scheduledDate,
          scheduledStartTime,
          scheduledEndTime,
          sessionStatus: 'CREATED',
          createdBy: admin.id,
          roomName,
          recordingEnabled: dto.consultationMode === ConsultationMode.VIDEO,
          reasonForVisit: dto.reasonForVisit ?? null,
          patientInstructions: dto.patientInstructions ?? null,
          internalNotes: dto.internalNotes ?? null,
        },
        include: sessionWithProfilesInclude,
      });

      await this.createAudit(tx, tenant.id, {
        consultationSessionId: created.sessionId,
        action: 'ADMIN_SESSION_CREATED',
        actorUserId: admin.id,
        actorRole: UserRole.ADMIN,
        previousStatus: null,
        newStatus: SessionStatus.CREATED,
        metadata: {
          sessionType: created.sessionType,
          consultationMode: created.consultationMode,
          scheduledStartTime: created.scheduledStartTime.toISOString(),
          scheduledEndTime: created.scheduledEndTime?.toISOString() ?? null,
        },
      });

      return this.mapSession(created);
    });
  }

  async listAdminSessions(adminUserId: string, query: ListConsultationSessionsQueryDto, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: adminUserId }, select: { id: true, role: true } });
      if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
      this.assertRole(admin.role, UserRole.ADMIN);

      const rows = await tx.consultationSession.findMany({
        where: {
          createdBy: adminUserId,
          ...(query.date ? { scheduledDate: this.toJakartaDateOnly(query.date) } : {}),
          ...(query.status ? { sessionStatus: query.status } : {}),
          ...this.buildSearchClause(query.search),
        },
        orderBy: this.normalizeSort(query.sort),
        include: sessionWithProfilesInclude,
      });

      return rows.map((item) => this.mapSession(item));
    });
  }

  async listAdminHistorySessions(adminUserId: string, query: ListConsultationSessionsQueryDto, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: adminUserId }, select: { id: true, role: true } });
      if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
      this.assertRole(admin.role, UserRole.ADMIN);

      const statusFilter = query.status
        ? { sessionStatus: query.status }
        : { sessionStatus: { in: [SessionStatus.COMPLETED, SessionStatus.FAILED] } };

      const where = {
        createdBy: adminUserId,
        ...(query.date ? { scheduledDate: this.toJakartaDateOnly(query.date) } : {}),
        ...statusFilter,
        ...this.buildSearchClause(query.search),
      };

      const orderBy = this.normalizeSort(query.sort);

      if (!query.limit) {
        const rows = await tx.consultationSession.findMany({
          where,
          orderBy,
          include: sessionWithProfilesInclude,
        });
        return rows.map((item) => this.mapSession(item));
      }

      const limit = query.limit;
      const rows = await tx.consultationSession.findMany({
        where,
        orderBy,
        take: limit + 1,
        skip: query.cursor ? 1 : 0,
        cursor: query.cursor ? { sessionId: query.cursor } : undefined,
        include: sessionWithProfilesInclude,
      });

      const hasNextPage = rows.length > limit;
      const data = hasNextPage ? rows.slice(0, limit) : rows;
      const nextCursor = hasNextPage ? data[data.length - 1].sessionId : null;

      return {
        data: data.map((item) => this.mapSession(item)),
        nextCursor,
        hasNextPage,
      };
    });
  }

  async listDoctorSessions(doctorId: string, query: ListConsultationSessionsQueryDto, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const doctor = await tx.user.findUnique({ where: { id: doctorId }, select: { id: true, role: true } });
      if (!doctor) throw new ForbiddenException('Dokter tidak ditemukan');
      this.assertRole(doctor.role, UserRole.DOCTOR);

      const rows = await tx.consultationSession.findMany({
        where: {
          doctorId,
          ...(query.date ? { scheduledDate: this.toJakartaDateOnly(query.date) } : {}),
          ...(query.status ? { sessionStatus: query.status } : {}),
          ...this.buildSearchClause(query.search),
        },
        orderBy: this.normalizeSort(query.sort),
        include: sessionWithProfilesInclude,
      });

      return rows.map((item) => this.mapSession(item));
    });
  }

  async listPatientSessions(patientId: string, query: ListConsultationSessionsQueryDto, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const patient = await tx.user.findUnique({ where: { id: patientId }, select: { id: true, role: true } });
      if (!patient) throw new ForbiddenException('Patient tidak ditemukan');
      this.assertRole(patient.role, UserRole.PATIENT);

      const where = {
        patientId,
        ...(query.date ? { scheduledDate: this.toJakartaDateOnly(query.date) } : {}),
        ...(query.status ? { sessionStatus: query.status } : {}),
        ...this.buildSearchClause(query.search),
      };

      const orderBy = this.normalizeSort(query.sort);

      if (!query.limit) {
        const rows = await tx.consultationSession.findMany({
          where,
          orderBy,
          include: sessionWithProfilesInclude,
        });
        return rows.map((item) => this.mapSession(item));
      }

      const limit = query.limit;

      // Validate cursor belongs to this patient to prevent cursor poisoning
      if (query.cursor) {
        const cursorRow = await tx.consultationSession.findFirst({
          where: { sessionId: query.cursor, patientId },
          select: { sessionId: true },
        });
        if (!cursorRow) throw new NotFoundException('Cursor tidak valid');
      }

      const rows = await tx.consultationSession.findMany({
        where,
        orderBy,
        take: limit + 1,
        skip: query.cursor ? 1 : 0,
        cursor: query.cursor ? { sessionId: query.cursor } : undefined,
        include: sessionWithProfilesInclude,
      });

      const hasNextPage = rows.length > limit;
      const data = hasNextPage ? rows.slice(0, limit) : rows;
      const nextCursor = hasNextPage ? data[data.length - 1].sessionId : null;

      return {
        data: data.map((item) => this.mapSession(item)),
        nextCursor,
        hasNextPage,
      };
    });
  }

  async listNurseSessions(nurseId: string, query: ListConsultationSessionsQueryDto, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const nurse = await tx.user.findUnique({ where: { id: nurseId }, select: { id: true, role: true } });
      if (!nurse) throw new ForbiddenException('Nurse tidak ditemukan');
      this.assertRole(nurse.role, UserRole.NURSE);

      const rows = await tx.consultationSession.findMany({
        where: {
          nurseId,
          ...(query.date ? { scheduledDate: this.toJakartaDateOnly(query.date) } : {}),
          ...(query.status ? { sessionStatus: query.status } : {}),
          ...this.buildSearchClause(query.search),
        },
        orderBy: this.normalizeSort(query.sort),
        include: sessionWithProfilesInclude,
      });

      return rows.map((item) => this.mapSession(item));
    });
  }

  async getSessionForDoctor(doctorId: string, sessionId: string, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const session = await tx.consultationSession.findUnique({ where: { sessionId }, include: sessionWithProfilesInclude });
      if (!session) throw new NotFoundException('Session tidak ditemukan');
      if (session.doctorId !== doctorId) throw new ForbiddenException('Bukan session dokter ini');
      return this.mapSession(session);
    });
  }

  async getSessionForPatient(patientId: string, sessionId: string, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const session = await tx.consultationSession.findUnique({ where: { sessionId }, include: sessionWithProfilesInclude });
      if (!session) throw new NotFoundException('Session tidak ditemukan');
      if (session.patientId !== patientId) throw new ForbiddenException('Bukan session patient ini');
      return this.mapSession(session);
    });
  }

  async getSessionForNurse(nurseId: string, sessionId: string, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const session = await tx.consultationSession.findUnique({ where: { sessionId }, include: sessionWithProfilesInclude });
      if (!session) throw new NotFoundException('Session tidak ditemukan');
      if (session.nurseId !== nurseId) throw new ForbiddenException('Bukan session nurse ini');
      return this.mapSession(session);
    });
  }

  async getSessionForAdmin(adminId: string, sessionId: string, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: adminId }, select: { id: true, role: true } });
      if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
      this.assertRole(admin.role, UserRole.ADMIN);

      const session = await tx.consultationSession.findUnique({ where: { sessionId }, include: sessionWithProfilesInclude });
      if (!session) throw new NotFoundException('Session tidak ditemukan');
      if (session.createdBy !== adminId) throw new ForbiddenException('Bukan session yang dibuat admin ini');
      return this.mapSession(session);
    });
  }

  async getConsultationNote(doctorId: string, sessionId: string, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const note = await tx.consultationNote.findFirst({
        where: { consultationSessionId: sessionId, doctorId },
        include: {
          consultationSession: {
            select: {
              sessionId: true,
              sessionStatus: true,
              consultationMode: true,
              sessionType: true,
              scheduledStartTime: true,
              scheduledEndTime: true,
              patientName: true,
              patientIdentity: true,
            },
          },
        },
      });

      if (!note) return null;

      await this.createAudit(tx, tenant.id, {
        consultationSessionId: sessionId,
        action: 'DOCTOR_VIEW_SUMMARY',
        actorUserId: doctorId,
        actorRole: UserRole.DOCTOR,
        metadata: { noteId: note.id },
      });

      return note;
    });
  }

  async cancelByAdmin(adminId: string, sessionId: string, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: adminId }, select: { id: true, role: true } });
      if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
      this.assertRole(admin.role, UserRole.ADMIN);

      const session = await tx.consultationSession.findUnique({
        where: { sessionId },
        select: { sessionId: true, sessionType: true, sessionStatus: true, createdBy: true },
      });
      if (!session) throw new NotFoundException('Session tidak ditemukan');
      if (session.createdBy !== adminId) throw new ForbiddenException('Hanya admin yang membuat session ini yang bisa cancel');
      if (session.sessionType !== 'SCHEDULED') throw new BadRequestException('Hanya SCHEDULED session yang bisa di-cancel');
      if (session.sessionStatus !== 'CREATED') throw new BadRequestException('Hanya session dengan status CREATED yang bisa di-cancel');

      await tx.consultationSession.delete({ where: { sessionId } });
    });
  }

  async rescheduleByAdmin(
    adminId: string,
    sessionId: string,
    dto: RescheduleConsultationSessionDto,
    tenant: TenantContext,
  ) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: adminId }, select: { id: true, role: true } });
      if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
      this.assertRole(admin.role, UserRole.ADMIN);

      const session = await tx.consultationSession.findUnique({
        where: { sessionId },
        include: sessionWithProfilesInclude,
      });
      if (!session) throw new NotFoundException('Session tidak ditemukan');
      if (session.createdBy !== adminId) throw new ForbiddenException('Hanya admin yang membuat session ini yang bisa reschedule');
      if (session.sessionType !== 'SCHEDULED') throw new BadRequestException('Hanya SCHEDULED session yang bisa di-reschedule');
      if (session.sessionStatus !== 'CREATED') throw new BadRequestException('Hanya session dengan status CREATED yang bisa di-reschedule');

      const newScheduledDate = this.toJakartaDateOnly(dto.scheduledDate);
      const newStart = this.toJakartaDate(dto.scheduledDate, dto.scheduledStartTime);
      const newEnd = this.toJakartaDate(dto.scheduledDate, dto.scheduledEndTime);

      this.assertScheduleWindow(newStart, newEnd);
      this.assertScheduleInFuture(newStart);

      const conflictSessions = await tx.consultationSession.findMany({
        where: {
          sessionId: { not: sessionId },
          OR: [{ doctorId: session.doctorId }, { patientId: session.patientId }],
          sessionStatus: { in: ['CREATED', 'IN_CALL'] },
          scheduledEndTime: { gt: new Date() },
        },
        select: { sessionId: true, doctorId: true, patientId: true, scheduledStartTime: true, scheduledEndTime: true },
      });

      for (const item of conflictSessions) {
        if (!this.hasOverlap(item.scheduledStartTime, item.scheduledEndTime, newStart, newEnd)) continue;
        if (item.doctorId === session.doctorId) throw new BadRequestException(`Jadwal dokter bentrok dengan session ${item.sessionId}`);
        if (item.patientId === session.patientId) throw new BadRequestException(`Jadwal patient bentrok dengan session ${item.sessionId}`);
      }

      const updated = await tx.consultationSession.update({
        where: { sessionId },
        data: {
          scheduledDate: newScheduledDate,
          scheduledStartTime: newStart,
          scheduledEndTime: newEnd,
        },
        include: sessionWithProfilesInclude,
      });

      await this.createAudit(tx, tenant.id, {
        consultationSessionId: sessionId,
        action: 'ADMIN_SESSION_RESCHEDULED',
        actorUserId: adminId,
        actorRole: UserRole.ADMIN,
        previousStatus: SessionStatus.CREATED,
        newStatus: SessionStatus.CREATED,
        metadata: {
          previousStart: session.scheduledStartTime.toISOString(),
          previousEnd: session.scheduledEndTime?.toISOString() ?? null,
          newStart: newStart.toISOString(),
          newEnd: newEnd.toISOString(),
        },
      });

      return this.mapSession(updated);
    });
  }

  async listDoctorOptions(adminId: string, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: adminId }, select: { id: true, role: true } });
      if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
      this.assertRole(admin.role, UserRole.ADMIN);

      const rows = await tx.doctorProfile.findMany({
        where: { license: { not: '' }, user: { isActive: true, role: UserRole.DOCTOR } },
        select: { userId: true, fullName: true, email: true, phone: true, license: true },
        orderBy: { fullName: 'asc' },
      });

      return rows.map((item) => ({ userId: item.userId, fullName: item.fullName, email: item.email, phone: item.phone, license: item.license }));
    });
  }

  async listNurseOptions(adminId: string, tenant: TenantContext) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: adminId }, select: { id: true, role: true } });
      if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
      this.assertRole(admin.role, UserRole.ADMIN);

      const rows = await tx.nurseProfile.findMany({
        where: { user: { isActive: true, role: UserRole.NURSE } },
        select: { userId: true, fullName: true, email: true, phone: true, nurseId: true },
        orderBy: { fullName: 'asc' },
      });

      return rows.map((item) => ({ userId: item.userId, fullName: item.fullName, email: item.email, phone: item.phone, nurseId: item.nurseId }));
    });
  }

  async listPatientOptions(adminId: string, tenant: TenantContext, search?: string) {
    return this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: adminId }, select: { id: true, role: true } });
      if (!admin) throw new ForbiddenException('Admin tidak ditemukan');
      this.assertRole(admin.role, UserRole.ADMIN);

      const searchFilter = search?.trim()
        ? {
            OR: [
              { fullName: { contains: search.trim(), mode: 'insensitive' as const } },
              { mrn: { contains: search.trim(), mode: 'insensitive' as const } },
            ],
          }
        : {};

      const rows = await tx.patientProfile.findMany({
        where: { user: { isActive: true, role: UserRole.PATIENT }, ...searchFilter },
        select: { userId: true, fullName: true, email: true, phone: true, mrn: true },
        orderBy: { fullName: 'asc' },
        take: 50,
      });

      return rows.map((item) => ({
        userId: item.userId,
        fullName: item.fullName,
        email: item.email,
        phone: item.phone,
        mrn: item.mrn,
      }));
    });
  }
}
