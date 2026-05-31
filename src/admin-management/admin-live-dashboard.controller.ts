import { Controller, Get, MessageEvent, Param, Patch, Query, Req, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { CurrentTenant } from 'src/tenant/tenant.decorator';
import type { TenantContext } from 'src/tenant/tenant.interface';
import { AdminLiveDashboardService } from './admin-live-dashboard.service';

@UseGuards(JwtGuard, AdminRoleGuard)
@Controller('admin/live-dashboard')
export class AdminLiveDashboardController {
  constructor(private readonly service: AdminLiveDashboardService) {}

  @Get('stats')
  getStats(@CurrentTenant() tenant: TenantContext) {
    return this.service.getStats(tenant.id, tenant.schemaName);
  }

  @Get('stuck-sessions')
  getStuckSessions(@CurrentTenant() tenant: TenantContext) {
    return this.service.getStuckSessions(tenant.id, tenant.schemaName);
  }

  @Get('recent-sessions')
  getRecentSessions(
    @CurrentTenant() tenant: TenantContext,
    @Query('search') search?: string,
    @Query('status') status?: string,
  ) {
    return this.service.getRecentSessions(tenant.id, tenant.schemaName, search, status);
  }

  @Sse('stream')
  stream(@CurrentTenant() tenant: TenantContext): Observable<MessageEvent> {
    return this.service.getStream(tenant.id, tenant.schemaName);
  }

  @Patch('sessions/:sessionId/force-complete')
  forceComplete(
    @CurrentTenant() tenant: TenantContext,
    @Param('sessionId') sessionId: string,
    @Req() req: any,
  ) {
    return this.service.forceComplete(tenant.id, tenant.schemaName, sessionId, {
      id: req.user.id, name: req.user.email, role: req.user.role,
    });
  }
}
