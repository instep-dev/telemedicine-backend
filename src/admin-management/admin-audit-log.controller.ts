import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from 'src/auth/guards/jwt.guard';
import { AdminRoleGuard } from './admin-role.guard';
import { CurrentTenant } from 'src/tenant/tenant.decorator';
import type { TenantContext } from 'src/tenant/tenant.interface';
import { AdminAuditLogService } from './admin-audit-log.service';
import { AuditLogQueryDto } from './dto/admin-audit-log.dto';

@UseGuards(JwtGuard, AdminRoleGuard)
@Controller('admin/audit-log')
export class AdminAuditLogController {
  constructor(private readonly service: AdminAuditLogService) {}

  @Get()
  findAll(@CurrentTenant() tenant: TenantContext, @Query() query: AuditLogQueryDto) {
    return this.service.findAll(tenant.id, tenant.schemaName, query);
  }

  @Get('sessions')
  findSessionAudits(@CurrentTenant() tenant: TenantContext, @Query('cursor') cursor?: string) {
    return this.service.findSessionAudits(tenant.id, tenant.schemaName, cursor);
  }

  @Get(':id')
  findOne(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.findOne(tenant.id, tenant.schemaName, id);
  }
}
