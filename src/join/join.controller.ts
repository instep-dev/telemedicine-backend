import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentTenant } from '../tenant/tenant.decorator';
import type { TenantContext } from '../tenant/tenant.interface';
import { JoinService } from './join.service';

@Controller('join')
export class JoinController {
  constructor(private readonly joinService: JoinService) {}

  @Get(':sessionId/info')
  async getSessionInfo(
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (!tenant) throw new BadRequestException('Tenant header X-Tenant-Slug diperlukan');
    return this.joinService.getPublicSessionInfo(sessionId, tenant.slug);
  }

  @Post(':sessionId/check-in')
  async checkIn(
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
    @Body('name') name: string,
  ) {
    if (!tenant) throw new BadRequestException('Tenant header X-Tenant-Slug diperlukan');
    return this.joinService.checkIn(sessionId, tenant.slug, name);
  }

  @Post(':sessionId/patient-token')
  async patientToken(
    @Param('sessionId') sessionId: string,
    @CurrentTenant() tenant: TenantContext,
    @Body('checkInName') checkInName?: string,
  ) {
    if (!tenant) throw new BadRequestException('Tenant header X-Tenant-Slug diperlukan');
    return this.joinService.getPublicPatientToken(sessionId, tenant.slug, checkInName);
  }

  @Get(':sessionId/events')
  sseEvents(
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial ping
    res.write('data: {"type":"connected"}\n\n');

    this.joinService.addSseClient(sessionId, res);

    // Keepalive every 20s
    const heartbeat = setInterval(() => {
      try {
        res.write('data: {"type":"ping"}\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 20_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      this.joinService.removeSseClient(sessionId, res);
    });
  }
}
