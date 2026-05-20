import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  MessageEvent,
  Param,
  Patch,
  Post,
  Req,
  Res,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { UserRole } from '@prisma/client';
import { Observable, Subject } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { CurrentTenant } from '../tenant/tenant.decorator';
import type { TenantContext } from '../tenant/tenant.interface';
import { UpdateSoapNoteDto } from './dto/soap-notes.dto';
import { SOAP_NOTE_UPDATED_EVENT, SoapNotesService } from './soap-notes.service';

@Controller('soap-notes')
@UseGuards(JwtGuard)
export class SoapNotesController {
  private readonly sseSubject = new Subject<{ sessionId: string; note: any }>();

  constructor(private readonly soapNotesService: SoapNotesService) {}

  @Get(':sessionId')
  async getNote(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    this.requireDoctorOrPatient(req.user.role);
    return this.soapNotesService.getNote(sessionId, req.user.id, req.user.role, tenant);
  }

  @Patch(':sessionId')
  async updateNote(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Body() dto: UpdateSoapNoteDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat mengubah SOAP note');
    }
    return this.soapNotesService.updateNote(sessionId, req.user.id, dto, tenant);
  }

  @Post(':sessionId/finalize')
  async finalizeNote(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat memfinalisasi SOAP note');
    }
    return this.soapNotesService.finalizeNote(sessionId, req.user.id, tenant);
  }

  @Sse(':sessionId/stream')
  async stream(
    @Req() req: any,
    @Param('sessionId') sessionId: string,
    @Res() res: any,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<Observable<MessageEvent>> {
    this.requireDoctorOrPatient(req.user.role);

    await this.soapNotesService.verifyStreamAccess(
      sessionId,
      req.user.id,
      req.user.role,
      tenant,
    );

    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const role = req.user.role as UserRole;

    return this.sseSubject.pipe(
      filter((event) => event.sessionId === sessionId),
      filter(
        (event) =>
          role === UserRole.DOCTOR ||
          ((role === UserRole.PATIENT || role === UserRole.NURSE) && event.note.isFinalized),
      ),
      map((event) => ({
        data: { type: 'NOTE_UPDATED', note: event.note },
      }) as MessageEvent),
    );
  }

  @OnEvent(SOAP_NOTE_UPDATED_EVENT)
  handleSoapNoteUpdated(payload: { sessionId: string; note: any }) {
    this.sseSubject.next(payload);
  }

  private requireDoctorOrPatient(role: UserRole) {
    if (role !== UserRole.DOCTOR && role !== UserRole.PATIENT && role !== UserRole.NURSE) {
      throw new ForbiddenException('Hanya dokter, pasien, atau nurse yang dapat mengakses SOAP note');
    }
  }
}
