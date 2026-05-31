import { Controller, Get, MessageEvent, NotFoundException, Param, Res, Sse } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { TenantService } from './tenant.service';
import { TENANT_STATUS_CHANGED_EVENT } from '../super-admin/super-admin-tenants.service';
import type { TenantStatusChangedPayload } from '../super-admin/super-admin-tenants.service';

@Controller('tenants')
export class TenantController {
  private readonly sseSubject = new Subject<TenantStatusChangedPayload>();

  constructor(private readonly tenantService: TenantService) {}

  @Get()
  listActive() {
    return this.tenantService.listActive();
  }

  // Public SSE — no auth needed, only broadcasts slug/name/status (no sensitive data)
  @Sse('events')
  events(@Res() res: any): Observable<MessageEvent> {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    return this.sseSubject.pipe(
      map((payload) => ({
        data: {
          type: 'TENANT_STATUS_CHANGED',
          slug: payload.slug,
          name: payload.name,
          status: payload.status,
        },
      }) as MessageEvent),
    );
  }

  @OnEvent(TENANT_STATUS_CHANGED_EVENT)
  handleTenantStatusChanged(payload: TenantStatusChangedPayload) {
    this.sseSubject.next(payload);
  }

  @Get('check/:slug')
  async checkSlug(@Param('slug') slug: string) {
    const valid = await this.tenantService.isActiveSlug(slug);
    if (!valid) throw new NotFoundException('Tenant tidak ditemukan');
    return { exists: true };
  }
}
