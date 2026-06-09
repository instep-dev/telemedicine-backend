import { Body, Controller, Get, MessageEvent, Param, Patch, Post, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { CurrentTenant } from 'src/tenant/tenant.decorator';
import type { TenantContext } from 'src/tenant/tenant.interface';
import { AdminNursesService, NURSE_LIST_CHANGED } from './admin-nurses.service';
import { CreateNurseDto, ListNursesQueryDto, UpdateNurseDto } from './dto/admin-nurses.dto';

@UseGuards(JwtGuard, AdminRoleGuard)
@Controller('admin/nurses')
export class AdminNursesController {
  private readonly listChanged$ = new Subject<void>();

  constructor(private readonly service: AdminNursesService) {}

  @Sse('stream')
  nursesStream(@Req() req: any, @Res() res: any): Observable<MessageEvent> {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const disconnect$ = new Subject<void>();
    req.on('close', () => disconnect$.next());
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ data: JSON.stringify({ type: 'CONNECTED' }) } as MessageEvent);
      const sub = this.listChanged$.pipe(takeUntil(disconnect$))
        .subscribe(() => subscriber.next({ data: JSON.stringify({ type: 'NURSE_LIST_CHANGED' }) } as MessageEvent));
      return () => { sub.unsubscribe(); disconnect$.next(); };
    });
  }

  @OnEvent(NURSE_LIST_CHANGED)
  handleNurseListChanged() { this.listChanged$.next(); }

  @Get('count')
  countAll(@CurrentTenant() tenant: TenantContext) {
    return this.service.countAll(tenant.id, tenant.schemaName);
  }

  @Get()
  findAll(@CurrentTenant() tenant: TenantContext, @Query() query: ListNursesQueryDto) {
    return this.service.findAll(tenant.id, tenant.schemaName, query);
  }

  @Post()
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateNurseDto, @Req() req: any) {
    return this.service.create(tenant.id, tenant.schemaName, dto, {
      id: req.user.id, name: req.user.email, role: req.user.role,
    });
  }

  @Patch(':userId')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId') userId: string,
    @Body() dto: UpdateNurseDto,
    @Req() req: any,
  ) {
    return this.service.update(tenant.id, tenant.schemaName, userId, dto, {
      id: req.user.id, name: req.user.email, role: req.user.role,
    });
  }

  @Patch(':userId/toggle-active')
  toggleActive(@CurrentTenant() tenant: TenantContext, @Param('userId') userId: string, @Req() req: any) {
    return this.service.toggleActive(tenant.id, tenant.schemaName, userId, {
      id: req.user.id, name: req.user.email, role: req.user.role,
    });
  }
}
