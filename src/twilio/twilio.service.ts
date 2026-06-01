import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Inject,
  forwardRef
} from '@nestjs/common';
import {
  ConsultationMode,
  SessionStatus,
  SessionType,
  UserRole,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AiService } from 'src/ai-summary/ai.service';
import { LocalStorageService } from 'src/video/local-storage.service';
import { PrismaService } from 'prisma/prisma.service';
import { ConsultationsService } from '../consultations/consultations.service';
import type { TenantContext } from '../tenant/tenant.interface';
import { VideoTranscriptionDto } from './dto/twilio.dto';
import { VideoCallService } from './videocall.service';
import { VoiceCallService } from './voicecall.service';

interface TenantRow {
  id: string;
  slug: string;
  schema_name: string;
}

@Injectable()
export class TwilioService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TwilioService.name);
  private readonly statusCallbackUrl = (() => {
    const explicit = process.env.TWILIO_VIDEO_STATUS_CALLBACK_URL;
    const fallback = `${process.env.APP_BASE_URL}/twilio/webhooks/video-room`;
    const url = explicit || fallback;
    // Catch ngrok URLs accidentally left in production env vars
    if (process.env.NODE_ENV === 'production' && url.includes('ngrok')) {
      throw new Error(
        '[TwilioService] TWILIO_VIDEO_STATUS_CALLBACK_URL is an ngrok URL in production. ' +
        'Remove TWILIO_VIDEO_STATUS_CALLBACK_URL from env and set APP_BASE_URL to your production backend URL.',
      );
    }
    return url;
  })();

  private autoEndTimer: NodeJS.Timeout | null = null;
  private autoEndRunning = false;

  // Cache tenant list 5 menit — menghindari query public.tenant_registry setiap 30 detik
  private tenantCache: { data: TenantContext[]; expiry: number } | null = null;
  private readonly TENANT_CACHE_TTL_MS = 5 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ConsultationsService))
    private readonly consultationsService: ConsultationsService,
    private readonly localStorage: LocalStorageService,
    private readonly aiService: AiService,
    private readonly videoCallService: VideoCallService,
    private readonly voiceCallService: VoiceCallService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.autoEndTimer = setInterval(() => {
      void this.runAutoEndCycle();
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.autoEndTimer) {
      clearInterval(this.autoEndTimer);
      this.autoEndTimer = null;
    }
  }

  // ─── Tenant helpers ──────────────────────────────────────────────────────────

  private async getAllActiveTenants(): Promise<TenantContext[]> {
    const rows = await this.prisma.$queryRaw<TenantRow[]>`
      SELECT id, slug, schema_name FROM public.tenant_registry WHERE status = 'active'
    `;
    return rows.map((r) => ({ id: r.id, slug: r.slug, schemaName: r.schema_name }));
  }

  /** Tenant list di-cache 5 menit untuk mengurangi query setiap polling cycle. */
  private async getCachedActiveTenants(): Promise<TenantContext[]> {
    const now = Date.now();
    if (this.tenantCache && now < this.tenantCache.expiry) {
      return this.tenantCache.data;
    }
    const data = await this.getAllActiveTenants();
    this.tenantCache = { data, expiry: now + this.TENANT_CACHE_TTL_MS };
    return data;
  }

  /** Invalidasi cache — dipanggil saat tenant baru dibuat atau status berubah. */
  invalidateTenantCache() {
    this.tenantCache = null;
  }

  async findSessionWithTenant(
    roomSid?: string,
    roomName?: string,
  ): Promise<{ session: any; tenant: TenantContext } | null> {
    const tenants = await this.getAllActiveTenants();
    for (const tenant of tenants) {
      const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        if (roomSid) {
          const bySid = await tx.consultationSession.findFirst({
            where: { twilioRoomSid: roomSid },
            include: { doctor: true },
          });
          if (bySid) return bySid;
        }
        if (roomName) {
          return tx.consultationSession.findFirst({
            where: { roomName },
            include: { doctor: true },
          });
        }
        return null;
      });
      if (session) return { session, tenant };
    }
    return null;
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────────

  private getProvider(mode: ConsultationMode) {
    if (mode === ConsultationMode.VOICE) return this.voiceCallService;
    return this.videoCallService;
  }

  private runInBackground(taskName: string, job: () => Promise<void>, delayMs = 0) {
    setTimeout(() => {
      void job().catch((err) => {
        this.logger.error(`[background:${taskName}] ${err?.message || err}`);
      });
    }, delayMs);
  }

  private assertJoinWindow(session: {
    sessionType: SessionType;
    sessionStatus: SessionStatus;
    scheduledStartTime: Date;
    scheduledEndTime: Date | null;
  }) {
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      throw new ForbiddenException('Session sudah ditutup');
    }

    if (session.sessionType === SessionType.INSTANT) return;

    if (!session.scheduledEndTime) {
      throw new BadRequestException('scheduled_end_time wajib untuk SCHEDULED');
    }

    const now = Date.now();
    const startMs = session.scheduledStartTime.getTime();
    const endMs = session.scheduledEndTime.getTime();

    if (now < startMs || now >= endMs) {
      throw new ForbiddenException(
        'Belum masuk window join atau session sudah melewati end time',
      );
    }
  }

  /**
   * Hitung TTL token Twilio berdasarkan sisa waktu sesi.
   * Untuk sesi INSTANT: 4 jam. Untuk sesi SCHEDULED: sisa waktu + buffer 5 menit.
   * Batas maksimum 4 jam, minimum 5 menit.
   */
  private calculateTokenTtl(session: {
    sessionType: SessionType;
    scheduledEndTime: Date | null;
  }): number {
    const MAX_TTL = 4 * 60 * 60;  // 4 jam
    const MIN_TTL = 5 * 60;        // 5 menit minimum

    if (session.sessionType === SessionType.INSTANT || !session.scheduledEndTime) {
      return MAX_TTL;
    }

    const remainingSec = Math.floor(
      (session.scheduledEndTime.getTime() - Date.now()) / 1000,
    );
    // Tambah 5 menit buffer agar tidak putus tepat di akhir window
    return Math.max(MIN_TTL, Math.min(remainingSec + 5 * 60, MAX_TTL));
  }

  private calculateDuration(startedAt: Date | null, endedAt: Date) {
    if (!startedAt) return { durationSec: 0, durationMinutes: 1 };
    const diffSec = Math.max(
      0,
      Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
    );
    const diffMin = Math.max(1, Math.ceil(diffSec / 60));
    return { durationSec: diffSec, durationMinutes: diffMin };
  }

  private async ensureRoom(
    session: {
      consultationMode: ConsultationMode;
      roomName: string;
      sessionId: string;
    },
    tenant: TenantContext,
  ) {
    const provider = this.getProvider(session.consultationMode);
    const room = await provider.ensureRoom(session.roomName, this.statusCallbackUrl);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: { twilioRoomSid: room.sid ?? undefined },
      });
    });

    return room;
  }

  // ─── Auto-end cycle (background) ────────────────────────────────────────────

  private async runAutoEndCycle() {
    if (this.autoEndRunning) return;
    this.autoEndRunning = true;

    try {
      // Gunakan cache agar tidak query DB setiap 30 detik
      const tenants = await this.getCachedActiveTenants();

      // Proses semua tenant secara PARALEL (bukan sequential)
      // Dengan 20 tenant: dari ~20 × query_time → max(query_time)
      await Promise.all(tenants.map((tenant) => this.processAutoEndForTenant(tenant)));
    } catch (error: any) {
      this.logger.error(`auto-end cycle failed: ${error?.message || error}`);
    } finally {
      this.autoEndRunning = false;
    }
  }

  private async processAutoEndForTenant(tenant: TenantContext) {
    const now = new Date();
    try {
      const dueSessions = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        return tx.consultationSession.findMany({
          where: {
            sessionType: 'SCHEDULED',
            sessionStatus: { in: ['CREATED', 'IN_CALL'] },
            scheduledEndTime: { lte: now },
          },
          select: {
            sessionId: true,
            doctorId: true,
            doctorJoinedAt: true,
            patientJoinedAt: true,
          },
        });
      });

      // Proses sesi due juga secara paralel per tenant
      await Promise.all(
        dueSessions.map((session) =>
          session.doctorJoinedAt && session.patientJoinedAt
            ? this.completeSessionInternal(
                session.sessionId,
                session.doctorId,
                'AUTO_END_COMPLETED',
                true,
                tenant,
              )
            : this.failSessionInternal(session.sessionId, 'AUTO_END_FAILED', true, tenant),
        ),
      );
    } catch (error: any) {
      // Per-tenant error tidak boleh mematikan cycle keseluruhan
      this.logger.error(
        `auto-end failed for tenant=${tenant.slug}: ${error?.message || error}`,
      );
    }
  }

  // ─── Session completion internals ────────────────────────────────────────────

  private async completeSessionInternal(
    sessionId: string,
    doctorId: string,
    action: string,
    isSystem: boolean,
    tenant: TenantContext,
  ) {
    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findUnique({
        where: { sessionId },
        include: { doctor: true },
      });
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') {
      return { success: true, sessionId, status: session.sessionStatus };
    }

    const endedAt = new Date();

    if (session.twilioRoomSid) {
      try {
        await this.videoCallService.completeRoom(session.twilioRoomSid);
      } catch (error: any) {
        this.logger.warn(
          `complete room warning sessionId=${sessionId} message=${error?.message || error}`,
        );
      }
    }

    const baseStart = session.startedAt ?? session.doctorJoinedAt ?? endedAt;
    const { durationMinutes, durationSec } = this.calculateDuration(baseStart, endedAt);

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId },
        data: {
          sessionStatus: 'COMPLETED',
          endedAt,
          durationMinutes,
          durationSec,
          ...(session.sessionType === 'INSTANT' && !session.scheduledEndTime
            ? { scheduledEndTime: endedAt }
            : {}),
        },
      });

      await tx.consultationNote.upsert({
        where: { consultationSessionId: session.sessionId },
        update: {
          doctorId: session.doctorId,
          nurseId: session.nurseId ?? null,
          aiStatus: 'PENDING',
          aiError: null,
        },
        create: {
          consultationSessionId: session.sessionId,
          tenantId: session.tenantId,
          doctorId: session.doctorId,
          patientId: session.patientId,
          nurseId: session.nurseId ?? null,
          aiStatus: 'PENDING',
          aiError: null,
        },
      });

      await this.consultationsService.createAudit(tx, tenant.id, {
        consultationSessionId: session.sessionId,
        action,
        actorUserId: isSystem ? null : doctorId,
        actorRole: isSystem ? null : UserRole.DOCTOR,
        previousStatus: session.sessionStatus,
        newStatus: SessionStatus.COMPLETED,
        metadata: { durationMinutes, auto: isSystem },
      });
    });

    this.runInBackground(
      `ai-summary:${session.sessionId}`,
      async () => {
        await this.aiService.processConsultationFromTranscript(session.sessionId, undefined, tenant);
      },
      1500,
    );

    return {
      success: true,
      sessionId: session.sessionId,
      roomSid: session.twilioRoomSid,
      status: 'COMPLETED',
      aiStatus: 'PENDING',
    };
  }

  private async failSessionInternal(
    sessionId: string,
    action: string,
    isSystem: boolean,
    tenant: TenantContext,
  ) {
    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findUnique({
        where: { sessionId },
        select: {
          sessionId: true,
          sessionStatus: true,
          scheduledEndTime: true,
          twilioRoomSid: true,
        },
      });
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') return;

    if (session.twilioRoomSid) {
      try {
        await this.videoCallService.completeRoom(session.twilioRoomSid);
      } catch (error: any) {
        this.logger.warn(
          `complete room on fail warning sessionId=${sessionId} message=${error?.message || error}`,
        );
      }
    }

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId },
        data: {
          sessionStatus: 'FAILED',
          endedAt: session.scheduledEndTime ?? new Date(),
          durationMinutes: null,
          durationSec: null,
        },
      });

      await this.consultationsService.createAudit(tx, tenant.id, {
        consultationSessionId: session.sessionId,
        action,
        actorUserId: null,
        actorRole: null,
        previousStatus: session.sessionStatus,
        newStatus: SessionStatus.FAILED,
        metadata: { auto: isSystem },
      });
    });
  }

  async markSessionFailedBySystem(
    sessionId: string,
    tenant: TenantContext,
    action = 'AUTO_END_FAILED',
  ) {
    return this.failSessionInternal(sessionId, action, true, tenant);
  }

  async markSessionCompletedBySystem(
    sessionId: string,
    doctorId: string,
    tenant: TenantContext,
    action = 'AUTO_END_COMPLETED',
  ) {
    return this.completeSessionInternal(sessionId, doctorId, action, true, tenant);
  }

  // ─── Token methods ───────────────────────────────────────────────────────────

  async doctorToken(doctorId: string, sessionId: string, tenant: TenantContext) {
    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findUnique({
        where: { sessionId },
        include: {
          doctor: {
            include: {
              doctorProfile: { select: { license: true } },
            },
          },
          patient: {
            include: {
              patientProfile: { select: { fullName: true } },
            },
          },
          nurse: true,
        },
      });
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');

    await this.consultationsService.createAuditForTenant(tenant, {
      consultationSessionId: session.sessionId,
      action: 'DOCTOR_JOIN_ATTEMPT',
      actorUserId: doctorId,
      actorRole: UserRole.DOCTOR,
      previousStatus: session.sessionStatus,
      newStatus: session.sessionStatus,
      metadata: { consultationMode: session.consultationMode },
    });

    if (session.doctorId !== doctorId) {
      await this.consultationsService.createAuditForTenant(tenant, {
        consultationSessionId: session.sessionId,
        action: 'DOCTOR_JOIN_DENIED',
        actorUserId: doctorId,
        actorRole: UserRole.DOCTOR,
        previousStatus: session.sessionStatus,
        newStatus: session.sessionStatus,
        metadata: { reason: 'NOT_ASSIGNED_DOCTOR' },
      });
      throw new ForbiddenException('Bukan session dokter ini');
    }

    if (!session.doctor.doctorProfile?.license?.trim()) {
      await this.consultationsService.createAuditForTenant(tenant, {
        consultationSessionId: session.sessionId,
        action: 'DOCTOR_JOIN_DENIED',
        actorUserId: doctorId,
        actorRole: UserRole.DOCTOR,
        previousStatus: session.sessionStatus,
        newStatus: session.sessionStatus,
        metadata: { reason: 'DOCTOR_LICENSE_EMPTY' },
      });
      throw new ForbiddenException('Dokter tanpa license tidak bisa join');
    }

    this.assertJoinWindow(session);

    const identity = session.doctor.twilioIdentity;
    if (!identity) {
      throw new BadRequestException('Twilio identity dokter belum tersedia');
    }

    await this.ensureRoom(session, tenant);

    const now = new Date();
    const isRejoin = !!session.doctorJoinedAt;
    const startedAt = !session.startedAt && session.patientJoinedAt ? now : session.startedAt;

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          doctorIdentity: identity,
          doctorJoinedAt: session.doctorJoinedAt ?? now,
          sessionStatus: 'IN_CALL',
          startedAt: startedAt ?? undefined,
        },
      });
    });

    await this.consultationsService.createAuditForTenant(tenant, {
      consultationSessionId: session.sessionId,
      action: isRejoin ? 'DOCTOR_REJOIN' : 'DOCTOR_JOIN_SUCCESS',
      actorUserId: doctorId,
      actorRole: UserRole.DOCTOR,
      previousStatus: session.sessionStatus,
      newStatus: SessionStatus.IN_CALL,
      metadata: { consultationMode: session.consultationMode, rejoin: isRejoin },
    });

    // Broadcast SSE to patient waiting room
    this.eventEmitter.emit('session.doctor_joined', { sessionId: session.sessionId });

    const provider = this.getProvider(session.consultationMode);
    const ttl = this.calculateTokenTtl(session);
    const token = provider.generateToken(identity, session.roomName, ttl);

    const participantNames: Record<string, string> = {};
    if (session.doctor.twilioIdentity) {
      participantNames[session.doctor.twilioIdentity] = session.doctor.name ?? 'Doctor';
    }
    const patientIdentity = `patient_${session.sessionId}_${session.patientId.slice(0, 8)}`;
    participantNames[patientIdentity] =
      session.patient?.patientProfile?.fullName ?? session.patient?.name ?? session.patientName ?? 'Patient';
    if (session.nurseId) {
      const nurseIdentity = `nurse_${session.sessionId}_${session.nurseId.slice(0, 8)}`;
      participantNames[nurseIdentity] = session.nurse?.name ?? 'Nurse';
    }

    return {
      token,
      roomName: session.roomName,
      identity,
      sessionId: session.sessionId,
      consultationMode: session.consultationMode,
      sessionType: session.sessionType,
      tokenTtlSec: ttl,
      participantNames,
    };
  }

  async patientToken(patientId: string, sessionId: string, tenant: TenantContext, _clientIp?: string | null) {
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

    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.patientId !== patientId) {
      throw new ForbiddenException('Bukan session patient ini');
    }

    this.assertJoinWindow(session);

    await this.ensureRoom(session, tenant);

    const identity = `patient_${session.sessionId}_${patientId.slice(0, 8)}`.slice(0, 128);
    const patientName =
      session.patient.patientProfile?.fullName ?? session.patient.name ?? 'Patient';

    const now = new Date();
    const isRejoin = !!session.patientJoinedAt;
    const startedAt = !session.startedAt && session.doctorJoinedAt ? now : session.startedAt;

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          patientIdentity: identity,
          patientName,
          patientJoinedAt: session.patientJoinedAt ?? now,
          sessionStatus: 'IN_CALL',
          startedAt: startedAt ?? undefined,
        },
      });
    });

    await this.consultationsService.createAuditForTenant(tenant, {
      consultationSessionId: session.sessionId,
      action: isRejoin ? 'PATIENT_REJOIN' : 'PATIENT_JOIN_SUCCESS',
      actorUserId: patientId,
      actorRole: UserRole.PATIENT,
      previousStatus: session.sessionStatus,
      newStatus: SessionStatus.IN_CALL,
      metadata: { consultationMode: session.consultationMode, rejoin: isRejoin },
    });

    const provider = this.getProvider(session.consultationMode);
    const ttl = this.calculateTokenTtl(session);
    const token = provider.generateToken(identity, session.roomName, ttl);

    const participantNames: Record<string, string> = {};
    if (session.doctor.twilioIdentity) {
      participantNames[session.doctor.twilioIdentity] = session.doctor.name ?? 'Doctor';
    }
    const patientIdentityKey = `patient_${session.sessionId}_${session.patientId.slice(0, 8)}`;
    participantNames[patientIdentityKey] = patientName;
    if (session.nurseId) {
      const nurseIdentity = `nurse_${session.sessionId}_${session.nurseId.slice(0, 8)}`;
      participantNames[nurseIdentity] = session.nurse?.name ?? 'Nurse';
    }

    return {
      token,
      roomName: session.roomName,
      identity,
      sessionId: session.sessionId,
      doctorName: session.doctor.name ?? 'Doctor',
      patientName,
      consultationMode: session.consultationMode,
      sessionType: session.sessionType,
      tokenTtlSec: ttl,
      participantNames,
    };
  }

  async nurseToken(nurseId: string, sessionId: string, tenant: TenantContext) {
    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findUnique({
        where: { sessionId },
        include: {
          doctor: true,
          patient: {
            include: { patientProfile: { select: { fullName: true } } },
          },
          nurse: {
            include: { nurseProfile: { select: { nurseId: true } } },
          },
        },
      });
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');
    if (session.nurseId !== nurseId) {
      throw new ForbiddenException('Bukan session nurse ini');
    }

    this.assertJoinWindow(session);

    await this.ensureRoom(session, tenant);

    const identity = `nurse_${session.sessionId}_${nurseId.slice(0, 8)}`.slice(0, 128);
    const now = new Date();
    const isRejoin = !!session.nurseJoinedAt;

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          nurseIdentity: identity,
          nurseJoinedAt: session.nurseJoinedAt ?? now,
        },
      });
    });

    await this.consultationsService.createAuditForTenant(tenant, {
      consultationSessionId: session.sessionId,
      action: isRejoin ? 'NURSE_REJOIN' : 'NURSE_JOIN_SUCCESS',
      actorUserId: nurseId,
      actorRole: UserRole.NURSE,
      previousStatus: session.sessionStatus,
      newStatus: session.sessionStatus,
      metadata: { consultationMode: session.consultationMode, rejoin: isRejoin },
    });

    const provider = this.getProvider(session.consultationMode);
    const ttl = this.calculateTokenTtl(session);
    const token = provider.generateToken(identity, session.roomName, ttl);

    const participantNames: Record<string, string> = {};
    if (session.doctor?.twilioIdentity) {
      participantNames[session.doctor.twilioIdentity] = session.doctor.name ?? 'Doctor';
    }
    const patientIdentity = `patient_${session.sessionId}_${session.patientId.slice(0, 8)}`;
    participantNames[patientIdentity] =
      session.patient?.patientProfile?.fullName ?? session.patient?.name ?? session.patientName ?? 'Patient';
    const nurseIdentity = `nurse_${session.sessionId}_${nurseId.slice(0, 8)}`;
    participantNames[nurseIdentity] = session.nurse?.name ?? 'Nurse';

    return {
      token,
      roomName: session.roomName,
      identity,
      sessionId: session.sessionId,
      consultationMode: session.consultationMode,
      sessionType: session.sessionType,
      tokenTtlSec: ttl,
      participantNames,
    };
  }

  async completeConsultationRoom(sessionId: string, doctorId: string, tenant: TenantContext) {
    return this.completeSessionInternal(sessionId, doctorId, 'DOCTOR_END_CALL', false, tenant);
  }

  async getCallSessionResult(doctorId: string, sessionId: string, tenant: TenantContext) {
    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findFirst({
        where: { sessionId, doctorId },
      });
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');

    let playableUrl: string | null = session.mediaUrl ?? null;
    if (!playableUrl && session.compositionSid) {
      playableUrl = await this.videoCallService.getCompositionMediaUrl(session.compositionSid, 3600);
    }

    return {
      sessionId: session.sessionId,
      sessionStatus: session.sessionStatus,
      consultationMode: session.consultationMode,
      consultationSession: session,
      playableUrl,
    };
  }

  async saveTranscription(doctorId: string, payload: VideoTranscriptionDto, tenant: TenantContext) {
    const sessionId = payload.sessionId?.trim();
    const transcription = payload.transcription?.trim();

    if (!sessionId) throw new BadRequestException('sessionId wajib');
    if (!transcription) return { success: true, ignored: true };

    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findFirst({
        where: { sessionId, doctorId },
        include: { consultationNote: true },
      });
    });

    if (!session) throw new NotFoundException('Session tidak ditemukan');

    const existing = session.consultationNote?.transcriptRaw ?? '';
    const currentStatus = String(session.consultationNote?.aiStatus ?? '').toUpperCase();
    const nextStatus =
      currentStatus === 'SUMMARIZING' || currentStatus === 'SUCCESS'
        ? session.consultationNote?.aiStatus ?? null
        : 'TRANSCRIBING';
    const nextTranscript = existing ? `${existing}\n${transcription}` : transcription;

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationNote.upsert({
        where: { consultationSessionId: sessionId },
        update: {
          doctorId,
          nurseId: session.nurseId ?? null,
          transcriptRaw: nextTranscript,
          transcribedAt: new Date(),
          ...(nextStatus ? { aiStatus: nextStatus, aiError: null } : {}),
        },
        create: {
          consultationSessionId: sessionId,
          tenantId: session.tenantId,
          doctorId,
          patientId: session.patientId,
          nurseId: session.nurseId ?? null,
          transcriptRaw: nextTranscript,
          transcribedAt: new Date(),
          aiStatus: nextStatus ?? 'TRANSCRIBING',
          aiError: null,
        },
      });
    });

    return { success: true };
  }

  async tryCreateComposition(roomSid: string, tenant: TenantContext) {
    const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      return tx.consultationSession.findFirst({ where: { twilioRoomSid: roomSid } });
    });

    if (!session) return null;
    if (session.compositionSid) return null;

    const recordings = await this.videoCallService.listRecordingsByRoomSid(roomSid);
    if (!recordings.length) return null;

    const hasPending = recordings.some(
      (item: any) => !['completed', 'failed', 'deleted'].includes(item.status),
    );
    if (hasPending) return null;

    const completed = recordings.some((item: any) => item.status === 'completed');
    if (!completed) return null;

    const composition = await this.videoCallService.createComposition(
      roomSid,
      this.statusCallbackUrl,
    );

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          compositionSid: composition.sid,
          compositionStatus: composition.status ?? 'enqueued',
        },
      });
    });

    return composition;
  }

  async publicPatientToken(
    session: any,
    tenant: { id: string; slug: string; schemaName: string },
    identity: string,
    displayName: string,
  ) {
    await this.ensureRoom(session, tenant);

    const now = new Date();
    const isRejoin = !!session.patientJoinedAt;
    const startedAt = !session.startedAt && session.doctorJoinedAt ? now : session.startedAt;

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          patientIdentity: identity,
          patientName: displayName,
          patientJoinedAt: session.patientJoinedAt ?? now,
          sessionStatus: 'IN_CALL',
          startedAt: startedAt ?? undefined,
        },
      });
    });

    const provider = this.getProvider(session.consultationMode);
    const ttl = this.calculateTokenTtl(session);
    const token = provider.generateToken(identity, session.roomName, ttl);

    const participantNames: Record<string, string> = {};
    if (session.doctor?.twilioIdentity) {
      participantNames[session.doctor.twilioIdentity] = session.doctor.name ?? 'Dokter';
    }
    participantNames[identity] = displayName;
    if (session.nurseId) {
      const nurseIdentity = `nurse_${session.sessionId}_${session.nurseId.slice(0, 8)}`;
      participantNames[nurseIdentity] = session.nurse?.name ?? 'Perawat';
    }

    return {
      token,
      roomName: session.roomName,
      identity,
      sessionId: session.sessionId,
      consultationMode: session.consultationMode,
      sessionType: session.sessionType,
      tokenTtlSec: ttl,
      participantNames,
    };
  }

  async getCompositionMediaUrl(compositionSid: string, ttl = 3600) {
    const url = await this.videoCallService.getCompositionMediaUrl(compositionSid, ttl);
    if (!url) throw new NotFoundException('Composition media URL not found');
    return url;
  }

  async downloadCompositionToLocal(compositionSid: string, sessionId: string) {
    const mediaUrl = await this.getCompositionMediaUrl(compositionSid, 3600);
    const response = await fetch(mediaUrl);
    if (!response.ok) {
      throw new Error(`Failed to download composition media: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = `session-${sessionId}-${randomUUID()}.mp4`;

    await this.localStorage.saveFromBuffer(filename, buffer);

    return {
      filename,
      publicUrl: this.localStorage.buildPublicUrl(filename),
    };
  }
}
