import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { TwilioService } from './twilio.service';

type WebhookBody = Record<string, any>;

@Injectable()
export class TwilioWebhookService {
  private readonly logger = new Logger(TwilioWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly twilioService: TwilioService,
  ) {}

  async handleVideoWebhook(body: WebhookBody) {
    const event = body.StatusCallbackEvent;
    const roomSid = body.RoomSid;
    const roomName = body.RoomName;

    this.logger.log(
      `Twilio webhook event=${event} roomSid=${roomSid} roomName=${roomName}`,
    );

    switch (event) {
      case 'participant-connected':
        return this.onParticipantConnected(body);
      case 'participant-disconnected':
        return this.onParticipantDisconnected(body);
      case 'room-ended':
        return this.onRoomEnded(body);
      case 'recording-started':
        return this.onRecordingStarted(body);
      case 'recording-completed':
        return this.onRecordingCompleted(body);
      case 'recording-failed':
        return this.onRecordingFailed(body);
      case 'composition-started':
        return this.onCompositionStarted(body);
      case 'composition-available':
        return this.onCompositionAvailable(body);
      case 'composition-failed':
        return this.onCompositionFailed(body);
      default:
        return;
    }
  }

  private async onParticipantConnected(body: WebhookBody) {
    const roomSid = body.RoomSid;
    const roomName = body.RoomName;
    const participantIdentity = body.ParticipantIdentity;
    const timestamp = body.Timestamp ? new Date(body.Timestamp) : new Date();

    const found = await this.twilioService.findSessionWithTenant(roomSid, roomName);
    if (!found || !participantIdentity) return;

    const { session, tenant } = found;
    const isDoctor =
      participantIdentity === session.doctorIdentity ||
      participantIdentity === session.doctor.twilioIdentity;

    const nextStartedAt =
      !session.startedAt &&
      (isDoctor ? !!session.patientJoinedAt : !!session.doctorJoinedAt)
        ? timestamp
        : session.startedAt;

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          sessionStatus: 'IN_CALL',
          startedAt: nextStartedAt ?? undefined,
          ...(isDoctor
            ? { doctorJoinedAt: session.doctorJoinedAt ?? timestamp }
            : {
                patientJoinedAt: session.patientJoinedAt ?? timestamp,
                patientIdentity: session.patientIdentity ?? participantIdentity,
              }),
        },
      });
    });
  }

  private async onParticipantDisconnected(body: WebhookBody) {
    const roomSid = body.RoomSid;
    const roomName = body.RoomName;
    const timestamp = body.Timestamp ? new Date(body.Timestamp) : new Date();

    const found = await this.twilioService.findSessionWithTenant(roomSid, roomName);
    if (!found) return;

    const { session, tenant } = found;
    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: { endedAt: session.endedAt ?? timestamp },
      });
    });
  }

  private async onRoomEnded(body: WebhookBody) {
    const roomSid = body.RoomSid;
    const roomName = body.RoomName;
    const timestamp = body.Timestamp ? new Date(body.Timestamp) : new Date();
    const roomDuration = body.RoomDuration ? Number(body.RoomDuration) : null;

    const found = await this.twilioService.findSessionWithTenant(roomSid, roomName);
    if (!found) return;

    const { session, tenant } = found;

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          endedAt: session.endedAt ?? timestamp,
          durationSec: roomDuration ?? session.durationSec ?? undefined,
          recordingStatus: 'processing',
        },
      });
    });

    if (session.sessionStatus === 'COMPLETED' || session.sessionStatus === 'FAILED') return;

    if (session.doctorJoinedAt && session.patientJoinedAt) {
      await this.twilioService.markSessionCompletedBySystem(
        session.sessionId,
        session.doctorId,
        tenant,
        'ROOM_ENDED_AUTO_COMPLETED',
      );
      return;
    }

    await this.twilioService.markSessionFailedBySystem(
      session.sessionId,
      tenant,
      'ROOM_ENDED_WITHOUT_BOTH_PARTICIPANTS',
    );
  }

  private async onRecordingStarted(body: WebhookBody) {
    const found = await this.twilioService.findSessionWithTenant(body.RoomSid, body.RoomName);
    if (!found) return;

    const { session, tenant } = found;
    const timestamp = body.Timestamp ? new Date(body.Timestamp) : new Date();

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          recordingStatus: 'started',
          recordingStartedAt: session.recordingStartedAt ?? timestamp,
        },
      });
    });
  }

  private async onRecordingCompleted(body: WebhookBody) {
    const found = await this.twilioService.findSessionWithTenant(body.RoomSid, body.RoomName);
    if (!found) return;

    const { session, tenant } = found;
    const timestamp = body.Timestamp ? new Date(body.Timestamp) : new Date();

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          recordingStatus: 'completed',
          recordingCompletedAt: timestamp,
        },
      });
    });

    if (session.twilioRoomSid) {
      void this.twilioService.tryCreateComposition(session.twilioRoomSid, tenant);
    }
  }

  private async onRecordingFailed(body: WebhookBody) {
    const found = await this.twilioService.findSessionWithTenant(body.RoomSid, body.RoomName);
    if (!found) return;

    const { session, tenant } = found;
    const errorMessage = body.ErrorMessage || body.FailedOperation || 'recording failed';

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: { recordingStatus: 'failed', errorMessage },
      });
    });
  }

  private async onCompositionStarted(body: WebhookBody) {
    const compositionSid = body.CompositionSid;
    if (!compositionSid) return;

    const timestamp = body.Timestamp ? new Date(body.Timestamp) : new Date();
    const tenants = await this.prisma.$queryRaw<Array<{ id: string; slug: string; schema_name: string }>>`
      SELECT id, slug, schema_name FROM public.tenant_registry WHERE status = 'active'
    `;

    for (const tenantRow of tenants) {
      await this.prisma.withTenantSchema(tenantRow.schema_name, async (tx) => {
        await tx.consultationSession.updateMany({
          where: { compositionSid },
          data: { compositionStatus: 'started', compositionStartedAt: timestamp },
        });
      });
    }
  }

  private async onCompositionAvailable(body: WebhookBody) {
    const compositionSid = body.CompositionSid;
    if (!compositionSid) return;

    const duration = body.Duration ? Number(body.Duration) : null;
    const timestamp = body.Timestamp ? new Date(body.Timestamp) : new Date();

    const tenants = await this.prisma.$queryRaw<Array<{ id: string; slug: string; schema_name: string }>>`
      SELECT id, slug, schema_name FROM public.tenant_registry WHERE status = 'active'
    `;

    let found: { session: any; tenant: { id: string; slug: string; schemaName: string } } | null = null;

    for (const tenantRow of tenants) {
      const tenant = { id: tenantRow.id, slug: tenantRow.slug, schemaName: tenantRow.schema_name };
      const session = await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
        return tx.consultationSession.findFirst({
          where: { compositionSid },
          select: { sessionId: true, durationSec: true },
        });
      });
      if (session) { found = { session, tenant }; break; }
    }

    if (!found) return;

    const { session, tenant } = found;

    await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
      await tx.consultationSession.update({
        where: { sessionId: session.sessionId },
        data: {
          compositionStatus: 'available',
          compositionReadyAt: timestamp,
          durationSec: duration ?? session.durationSec ?? undefined,
          errorMessage: null,
        },
      });
    });

    setTimeout(() => {
      void (async () => {
        try {
          const saved = await this.twilioService.downloadCompositionToLocal(
            compositionSid,
            session.sessionId,
          );
          await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
            await tx.consultationSession.update({
              where: { sessionId: session.sessionId },
              data: { mediaUrl: saved.publicUrl, mediaFormat: 'mp4', errorMessage: null },
            });
          });
        } catch (error: any) {
          this.logger.error(
            `Download composition failed sessionId=${session.sessionId} message=${error?.message || error}`,
          );
          await this.prisma.withTenantSchema(tenant.schemaName, async (tx) => {
            await tx.consultationSession.update({
              where: { sessionId: session.sessionId },
              data: { errorMessage: error?.message || String(error) },
            });
          });
        }
      })();
    }, 30_000);
  }

  private async onCompositionFailed(body: WebhookBody) {
    const compositionSid = body.CompositionSid;
    if (!compositionSid) return;

    const errorMessage = body.ErrorMessage || 'composition failed';
    const tenants = await this.prisma.$queryRaw<Array<{ schema_name: string }>>`
      SELECT schema_name FROM public.tenant_registry WHERE status = 'active'
    `;

    for (const tenantRow of tenants) {
      await this.prisma.withTenantSchema(tenantRow.schema_name, async (tx) => {
        await tx.consultationSession.updateMany({
          where: { compositionSid },
          data: { compositionStatus: 'failed', errorMessage },
        });
      });
    }
  }
}
