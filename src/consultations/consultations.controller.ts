import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';
import type { TenantContext } from '../tenant/tenant.interface';
import {
  CreateConsultationSessionDto,
  ListConsultationSessionsQueryDto,
} from './dto/consultations.dto';
import { ConsultationsService } from './consultations.service';

@Controller('consultations')
@UseGuards(JwtGuard)
export class ConsultationsController {
  constructor(private readonly consultations: ConsultationsService) {}

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
  async listPatients(@Req() req: any, @CurrentTenant() tenant: TenantContext) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listPatientOptions(req.user.id, tenant);
  }

  @Get('lookups/nurses')
  async listNurses(@Req() req: any, @CurrentTenant() tenant: TenantContext) {
    this.requireRole(req.user.role, UserRole.ADMIN);
    return this.consultations.listNurseOptions(req.user.id, tenant);
  }
}
