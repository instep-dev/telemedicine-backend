import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';
import type { TenantContext } from '../tenant/tenant.interface';
import {
  DoctorVideoTokenDto,
  PatientVideoTokenDto,
  VideoTranscriptionDto,
} from './dto/twilio.dto';
import { TwilioService } from './twilio.service';

const getClientIp = (req: any): string | null => {
  const forwarded = req.headers?.['x-forwarded-for'];
  const realIp = req.headers?.['x-real-ip'];
  const raw =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded) ??
    (Array.isArray(realIp) ? realIp[0] : realIp) ??
    req.ip ??
    req.connection?.remoteAddress ??
    null;

  if (!raw || typeof raw !== 'string') return null;
  const first = raw.split(',')[0]?.trim() ?? '';
  return first || null;
};

@Controller('twilio')
export class TwilioController {
  constructor(private readonly twilio: TwilioService) {}

  @UseGuards(JwtGuard)
  @Post('video/doctor-token')
  async doctorToken(
    @Req() req: any,
    @Body() dto: DoctorVideoTokenDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang boleh join sebagai dokter');
    }
    return this.twilio.doctorToken(req.user.id, dto.sessionId, tenant);
  }

  @UseGuards(JwtGuard)
  @Post('video/patient-token')
  async patientToken(
    @Req() req: any,
    @Body() dto: PatientVideoTokenDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.PATIENT) {
      throw new ForbiddenException('Hanya patient yang boleh join sebagai patient');
    }

    const reqIp = getClientIp(req);
    return this.twilio.patientToken(req.user.id, dto.sessionId, tenant, reqIp ?? dto.clientIp);
  }

  @UseGuards(JwtGuard)
  @Post('video/end/:sessionId')
  async endCall(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang boleh mengakhiri call');
    }
    return this.twilio.completeConsultationRoom(sessionId, req.user.id, tenant);
  }

  @UseGuards(JwtGuard)
  @Get('video/result/:sessionId')
  async getCallResult(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang bisa melihat result call');
    }
    return this.twilio.getCallSessionResult(req.user.id, sessionId, tenant);
  }

  @UseGuards(JwtGuard)
  @Post('video/nurse-token')
  async nurseToken(
    @Req() req: any,
    @Body() dto: DoctorVideoTokenDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.NURSE) {
      throw new ForbiddenException('Hanya nurse yang boleh join sebagai nurse');
    }
    return this.twilio.nurseToken(req.user.id, dto.sessionId, tenant);
  }

  @UseGuards(JwtGuard)
  @Post('video/transcription')
  async saveTranscription(
    @Req() req: any,
    @Body() dto: VideoTranscriptionDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang boleh kirim transcription');
    }
    return this.twilio.saveTranscription(req.user.id, dto, tenant);
  }
}
