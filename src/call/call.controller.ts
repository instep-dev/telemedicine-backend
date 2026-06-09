import {
  Controller,
  ForbiddenException,
  Get,
  MessageEvent,
  Param,
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
import { CallService } from './call.service';
import { GetCallsQueryDto, GetCallStatsQueryDto } from './dto/call.dto';
import { CALL_HISTORY_CHANGED } from '../twilio/twilio.service';

@Controller('call')
export class CallController {
  private readonly historyChanged$ = new Subject<void>();

  constructor(private readonly callService: CallService) {}

  @UseGuards(JwtGuard)
  @Sse('stream')
  callHistoryStream(@Req() req: any, @Res() res: any): Observable<MessageEvent> {
    if (req.user?.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat mengakses stream ini');
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const disconnect$ = new Subject<void>();
    req.on('close', () => disconnect$.next());
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ data: JSON.stringify({ type: 'CONNECTED' }) } as MessageEvent);
      const sub = this.historyChanged$.pipe(takeUntil(disconnect$))
        .subscribe(() => subscriber.next({ data: JSON.stringify({ type: 'CALL_HISTORY_CHANGED' }) } as MessageEvent));
      return () => { sub.unsubscribe(); disconnect$.next(); };
    });
  }

  @OnEvent(CALL_HISTORY_CHANGED)
  handleCallHistoryChanged() { this.historyChanged$.next(); }

  @UseGuards(JwtGuard)
  @Get()
  async findAll(
    @Req() req: any,
    @Query() query: GetCallsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role === UserRole.NURSE) {
      return this.callService.findAllByNurse(req.user.id, query, tenant);
    }
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter dan perawat yang dapat melihat history call');
    }
    return this.callService.findAllByDoctor(req.user.id, query, tenant);
  }

  @UseGuards(JwtGuard)
  @Get('statistics')
  async getStatistics(
    @Req() req: any,
    @Query() query: GetCallStatsQueryDto,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat melihat statistik call');
    }
    return this.callService.getDailyStatistics(req.user.id, query, tenant);
  }

  @UseGuards(JwtGuard)
  @Get(':id')
  async findById(
    @Req() req: any,
    @Param('id') id: string,
    @CurrentTenant() tenant: TenantContext,
  ) {
    if (req.user.role !== UserRole.DOCTOR) {
      throw new ForbiddenException('Hanya dokter yang dapat melihat detail call');
    }
    return this.callService.findDetailById(req.user.id, id, tenant);
  }
}
