import { Body, Controller, Get, MessageEvent, Param, Patch, Post, Res, Sse, UseGuards } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  SuperAdminTenantsService,
  TENANT_STATUS_CHANGED_EVENT,
} from './super-admin-tenants.service';
import type { TenantStatusChangedPayload } from './super-admin-tenants.service';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@UseGuards(SuperAdminJwtGuard)
@Controller('super-admin/tenants')
export class SuperAdminTenantsController {
  private readonly sseSubject = new Subject<TenantStatusChangedPayload>();

  constructor(private readonly tenantsService: SuperAdminTenantsService) {}

  @Get()
  findAll() {
    return this.tenantsService.findAll();
  }

  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  // Must be before @Get(':id') to avoid route conflict
  @Sse('events')
  events(@Res() res: any): Observable<MessageEvent> {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');
    return this.sseSubject.pipe(
      map((payload) => ({
        data: {
          type: 'TENANT_STATUS_CHANGED',
          id: payload.id,
          slug: payload.slug,
          status: payload.status,
        },
      }) as MessageEvent),
    );
  }

  @OnEvent(TENANT_STATUS_CHANGED_EVENT)
  handleTenantStatusChanged(payload: TenantStatusChangedPayload) {
    this.sseSubject.next(payload);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tenantsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string) {
    return this.tenantsService.activate(id);
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.tenantsService.deactivate(id);
  }
}
