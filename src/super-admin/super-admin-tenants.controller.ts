import { Body, Controller, Get, MessageEvent, Param, Patch, Post, Query, Req, Res, Sse, UseGuards, HttpCode } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Observable, Subject } from 'rxjs';
import { map, takeUntil } from 'rxjs/operators';
import {
  SuperAdminTenantsService,
  TENANT_STATUS_CHANGED_EVENT,
  TENANT_LIST_UPDATED_EVENT,
} from './super-admin-tenants.service';
import type { TenantStatusChangedPayload } from './super-admin-tenants.service';
import { SuperAdminJwtGuard } from './guards/super-admin-jwt.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@UseGuards(SuperAdminJwtGuard)
@Controller('super-admin/tenants')
export class SuperAdminTenantsController {
  private readonly sseSubject        = new Subject<TenantStatusChangedPayload>();
  private readonly listUpdated$      = new Subject<void>();

  constructor(private readonly tenantsService: SuperAdminTenantsService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('subscriptionPlan') subscriptionPlan?: string,
  ) {
    return this.tenantsService.findAll({ status, subscriptionPlan });
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

  // SSE: stream 3 tenant terbaru — push saat connect & saat list berubah
  @Sse('recent-stream')
  async recentStream(@Req() req: any, @Res() res: any): Promise<Observable<MessageEvent>> {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const disconnect$ = new Subject<void>();
    req.on('close', () => disconnect$.next());

    return new Observable<MessageEvent>((subscriber) => {
      const push = async () => {
        try {
          const tenants = await this.tenantsService.findRecent(3);
          subscriber.next({ data: JSON.stringify(tenants) } as MessageEvent);
        } catch {
          // transient error — skip tick
        }
      };

      // Kirim data langsung saat client connect
      push();

      // Subscribe ke event perubahan list
      const sub = this.listUpdated$
        .pipe(takeUntil(disconnect$))
        .subscribe(() => push());

      return () => {
        sub.unsubscribe();
        disconnect$.next();
      };
    });
  }

  @OnEvent(TENANT_LIST_UPDATED_EVENT)
  handleTenantListUpdated() {
    this.listUpdated$.next();
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

  // Run arbitrary DDL statements on all tenant schemas.
  // Use {{schema}} as placeholder — it will be replaced with each schema name.
  // Example body: { "statements": ["CREATE INDEX IF NOT EXISTS \"idx\" ON \"{{schema}}\".\"Table\"(col)"] }
  @Post('migrate-schemas')
  @HttpCode(200)
  migrateSchemas(@Body() body: { statements: string[] }) {
    return this.tenantsService.runMigrationOnAllSchemas(body.statements ?? []);
  }
}
