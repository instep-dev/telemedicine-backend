import { Body, Controller, Get, MessageEvent, Param, Patch, Post, Query, Req, Res, Sse, UseGuards } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { CurrentTenant } from 'src/tenant/tenant.decorator';
import type { TenantContext } from 'src/tenant/tenant.interface';
import { AdminDoctorsService, DOCTOR_LIST_CHANGED } from './admin-doctors.service';
import { CreateDoctorDto, ListDoctorsQueryDto, UpdateDoctorDto } from './dto/admin-doctors.dto';

@UseGuards(JwtGuard, AdminRoleGuard)
@Controller('admin/doctors')
export class AdminDoctorsController {
  private readonly listChanged$ = new Subject<void>();

  constructor(private readonly service: AdminDoctorsService) {}

  @Sse('stream')
  doctorsStream(@Req() req: any, @Res() res: any): Observable<MessageEvent> {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    const disconnect$ = new Subject<void>();
    req.on('close', () => disconnect$.next());
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ data: JSON.stringify({ type: 'CONNECTED' }) } as MessageEvent);
      const sub = this.listChanged$.pipe(takeUntil(disconnect$))
        .subscribe(() => subscriber.next({ data: JSON.stringify({ type: 'DOCTOR_LIST_CHANGED' }) } as MessageEvent));
      return () => { sub.unsubscribe(); disconnect$.next(); };
    });
  }

  @OnEvent(DOCTOR_LIST_CHANGED)
  handleDoctorListChanged() { this.listChanged$.next(); }

  @Get()
  findAll(@CurrentTenant() tenant: TenantContext, @Query() query: ListDoctorsQueryDto) {
    return this.service.findAll(tenant.id, tenant.schemaName, query);
  }

  @Post()
  create(@CurrentTenant() tenant: TenantContext, @Body() dto: CreateDoctorDto, @Req() req: any) {
    return this.service.create(tenant.id, tenant.schemaName, dto, {
      id: req.user.id, name: req.user.email, role: req.user.role,
    });
  }

  @Patch(':userId')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId') userId: string,
    @Body() dto: UpdateDoctorDto,
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
