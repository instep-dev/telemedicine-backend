import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { UserRole } from '@prisma/client';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';
import type { TenantContext } from '../tenant/tenant.interface';
import {
  CreateConsultationSessionDto,
  ListConsultationSessionsQueryDto,
  RescheduleConsultationSessionDto,
} from './dto/consultations.dto';
import { ConsultationsService, CONSULTATION_SESSION_CHANGED } from './consultations.service';
import { PATIENT_HISTORY_CHANGED } from '../twilio/twilio.service';

@Controller('consultations')
@UseGuards(JwtGuard)
export class ConsultationsController {
  private readonly historyChanged$ = new Subject<void>();

  constructor(private readonly consultations: ConsultationsService) {}

  @Sse('sessions/patient/stream')
  patientHistoryStream(@Req() req: any, @Res() res: any): Observable<MessageEvent> {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const disconnect$ = new Subject<void>();
    req.on('close', () => disconnect$.next());
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ data: JSON.stringify({ type: 'CONNECTED' }) } as MessageEvent);
      const sub = this.historyChanged$.pipe(takeUntil(disconnect$))
        .subscribe(() => subscriber.next({ data: JSON.stringify({ type: 'PATIENT_HISTORY_CHANGED' }) } as MessageEvent));
      return () => { sub.unsubscribe(); disconnect$.next(); };
    });
  }

  @OnEvent(CONSULTATION_SESSION_CHANGED)
  handleSessionChanged() { this.historyChanged$.next(); }

  @OnEvent(PATIENT_HISTORY_CHANGED)
  handlePatientHistoryChanged() { this.historyChanged$.next(); }

  private requireRole(actual: UserRole, expected: UserRole) {
    if (actual !== expected) {
      throw new ForbiddenException('Role tidak diizinkan untuk endpoint ini');
    }
  }

  @Post('sessions')
  async createSession(
    @Req() req: any,
    @Body() dto: CreateConsultationSessionDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.createByAdmin(req.user.id, dto, tenant);
  }

  @Get('sessions/admin')
  async listAdminSessions(
    @Req() req: any,
    @Query() query: ListConsultationSessionsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listAdminSessions(req.user.id, query, tenant);
  }

  @Get('sessions/admin/history')
  async listAdminHistorySessions(
    @Req() req: any,
    @Query() query: ListConsultationSessionsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listAdminHistorySessions(req.user.id, query, tenant);
  }

  @Get('sessions/doctor')
  async listDoctorSessions(
    @Req() req: any,
    @Query() query: ListConsultationSessionsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireRole(req.user.role, UserRole.DOCTOR);
    return this.consultations.listDoctorSessions(req.user.id, query, tenant);
  }

  @Get('sessions/patient')
  async listPatientSessions(
    @Req() req: any,
    @Query() query: ListConsultationSessionsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireRole(req.user.role, UserRole.PATIENT);
    return this.consultations.listPatientSessions(req.user.id, query, tenant);
  }

  @Get('sessions/nurse')
  async listNurseSessions(
    @Req() req: any,
    @Query() query: ListConsultationSessionsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireRole(req.user.role, UserRole.NURSE);
    return this.consultations.listNurseSessions(req.user.id, query, tenant);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async cancelSession(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.cancelByAdmin(req.user.id, sessionId, tenant);
  }

  @Patch('sessions/:sessionId/reschedule')
  async rescheduleSession(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: RescheduleConsultationSessionDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.rescheduleByAdmin(req.user.id, sessionId, dto, tenant);
  }

  @Get('sessions/:sessionId')
  async getSession(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role === UserRole.ADMIN) {
      return this.consultations.getSessionForAdmin(req.user.id, sessionId, tenant);
    }
    if (req.user.role === UserRole.DOCTOR) {
      return this.consultations.getSessionForDoctor(req.user.id, sessionId, tenant);
    }
    if (req.user.role === UserRole.PATIENT) {
      return this.consultations.getSessionForPatient(req.user.id, sessionId, tenant);
    }
    if (req.user.role === UserRole.NURSE) {
      return this.consultations.getSessionForNurse(req.user.id, sessionId, tenant);
    }
    throw new ForbiddenException('Role tidak diizinkan');
  }

  @Get('sessions/:sessionId/note')
  async getSessionNote(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireRole(req.user.role, UserRole.DOCTOR);
    return this.consultations.getConsultationNote(req.user.id, sessionId, tenant);
  }

  @Get('lookups/doctors')
  async listDoctors(@Req() req: any, @CurrentTenant() tenant: TenantContext) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listDoctorOptions(req.user.id, tenant);
  }

  @Get('lookups/patients')
  async listPatients(
    @Req() req: any,
    @CurrentTenant() tenant: TenantContext,
    @Query('search') search?: string,
  ) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listPatientOptions(req.user.id, tenant, search);
  }

  @Get('lookups/nurses')
  async listNurses(@Req() req: any, @CurrentTenant() tenant: TenantContext) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listNurseOptions(req.user.id, tenant);
  }
}
