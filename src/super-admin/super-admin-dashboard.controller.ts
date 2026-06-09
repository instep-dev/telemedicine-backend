import { Controller, Get, MessageEvent, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { SuperAdminDashboardService } from './super-admin-dashboard.service';
import type { AnalyticsPeriod } from './super-admin-dashboard.service';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';
import { CALL_HISTORY_CHANGED } from '../twilio/twilio.service';

@UseGuards(SuperAdminJwtGuard)
@Controller('super-admin/dashboard')
export class SuperAdminDashboardController {
  private readonly analyticsChanged$ = new Subject<void>();

  constructor(private readonly dashboardService: SuperAdminDashboardService) {}

  @Get('stats')
  getStats() {
    return this.dashboardService.getStats();
  }

  @Get('recent-jobs')
  getRecentJobs() {
    return this.dashboardService.getRecentJobs(5);
  }

  @Get('analytics')
  getAnalytics(@Query('period') period: string = '12months') {
    return this.dashboardService.getAnalytics((period as AnalyticsPeriod) || '12months');
  }

  @Sse('analytics/stream')
  analyticsStream(@Req() req: any, @Res() res: any): Observable<MessageEvent> {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const disconnect$ = new Subject<void>();
    req.on('close', () => disconnect$.next());

    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ data: JSON.stringify({ type: 'CONNECTED' }) } as MessageEvent);

      const sub = this.analyticsChanged$
        .pipe(takeUntil(disconnect$))
        .subscribe(() =>
          subscriber.next({ data: JSON.stringify({ type: 'ANALYTICS_CHANGED' }) } as MessageEvent),
        );

      return () => {
        sub.unsubscribe();
        disconnect$.next();
      };
    });
  }

  @OnEvent(CALL_HISTORY_CHANGED)
  handleCallHistoryChanged() {
    this.analyticsChanged$.next();
  }
}
